// One folder's index: which files it holds (with the size and modified time they had), their
// passages, and one vector per passage in a fixed-size FLOAT array column. Every file is
// written in one transaction, so stopping a run at any point leaves a consistent index that
// the next run continues from.

import type { DuckDBConnection } from "@duckdb/node-api";
import { loadDuckDb } from "../engines/duckdb/load-duckdb.ts";
import type { Chunk } from "./chunking.ts";
import { type IndexAccess, type IndexDatabase, openIndexDatabase } from "./index-database.ts";

export interface IndexMeta {
  /** Real path of the indexed folder. */
  root: string;
  /** The model the vectors came from; a search with another model would be meaningless. */
  embeddingModel: string;
  /** Vector size. Undefined until the first passage is stored. */
  dimensions: number | undefined;
  /** ISO time the last indexing run ended. */
  updatedAt: string | undefined;
  /** False when the last run was cancelled or failed part-way. */
  complete: boolean;
}

/** A file as it was when indexed. Paths are relative to the root, with "/" separators. */
export interface FileRecord {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
  /** Why the file has no passages ("no text layer", "not text"), when it has none. */
  note?: string;
}

export interface IndexedFile extends FileRecord {
  fileId: number;
  chunkCount: number;
}

const schemaVersion = "1";
/** DuckDB's vector size: the most rows one data chunk carries to the appender. */
const rowsPerDataChunk = 2048;

export class IndexStore {
  private readonly database: IndexDatabase;
  private dimensions: number | undefined;
  private nextFileId = 1;
  private madePrivateAfterWrite = false;

  private constructor(database: IndexDatabase) {
    this.database = database;
  }

  static async open(indexFile: string, access: IndexAccess): Promise<IndexStore> {
    const store = new IndexStore(await openIndexDatabase(indexFile, access));
    try {
      await store.loadState();
    } catch (error) {
      await store.close();
      throw error;
    }
    return store;
  }

  get connection(): DuckDBConnection {
    return this.database.connection;
  }

  /** Undefined for a file that was created but never initialized. */
  async readMeta(): Promise<IndexMeta | undefined> {
    if (!(await this.tableExists("meta"))) return undefined;
    const rows = await this.rows("SELECT key, value FROM meta");
    const values = new Map(rows.map((row) => [String(row.key), String(row.value)]));
    const root = values.get("root");
    const embeddingModel = values.get("embedding_model");
    if (root === undefined || embeddingModel === undefined) return undefined;
    const dimensions = values.get("dimensions");
    return {
      root,
      embeddingModel,
      dimensions: dimensions === undefined ? undefined : Number(dimensions),
      updatedAt: values.get("updated_at"),
      complete: values.get("complete") === "true",
    };
  }

  /** Creates the tables of a new index. The passage table waits for the vector size. */
  async initialize(root: string, embeddingModel: string): Promise<void> {
    await this.inTransaction(async () => {
      await this.connection.run("CREATE TABLE meta (key VARCHAR, value VARCHAR)");
      await this.connection.run(
        "CREATE TABLE files (file_id INTEGER, path VARCHAR, size_bytes BIGINT, modified_ms BIGINT, chunk_count INTEGER, note VARCHAR)",
      );
      await this.setMeta("schema_version", schemaVersion);
      await this.setMeta("root", root);
      await this.setMeta("embedding_model", embeddingModel);
      await this.setMeta("complete", "false");
    });
  }

  async listFiles(): Promise<IndexedFile[]> {
    const rows = await this.rows(
      "SELECT file_id, path, size_bytes, modified_ms, chunk_count, note FROM files ORDER BY path",
    );
    return rows.map((row) => {
      const file: IndexedFile = {
        fileId: Number(row.file_id),
        path: String(row.path),
        sizeBytes: Number(row.size_bytes),
        modifiedMs: Number(row.modified_ms),
        chunkCount: Number(row.chunk_count),
      };
      if (row.note !== null) file.note = String(row.note);
      return file;
    });
  }

  /** Files that have passages, and passages in all. */
  async counts(): Promise<{ files: number; chunks: number }> {
    const [row] = await this.rows(
      "SELECT count(*) FILTER (WHERE chunk_count > 0) AS files, coalesce(sum(chunk_count), 0) AS chunks FROM files",
    );
    return { files: Number(row?.files ?? 0), chunks: Number(row?.chunks ?? 0) };
  }

  /**
   * Stores a file with its passages, replacing what the index held for it. `replacesFileId`
   * is the id of the earlier version, when there was one.
   */
  async replaceFile(
    record: FileRecord,
    chunks: readonly Chunk[],
    vectors: readonly number[][],
    replacesFileId?: number,
  ): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new Error(`replaceFile: ${chunks.length} passages but ${vectors.length} vectors`);
    }
    const fileId = replacesFileId ?? this.nextFileId++;
    try {
      await this.inTransaction(async () => {
        if (chunks.length > 0) await this.ensureChunkTable((vectors[0] as number[]).length);
        if (replacesFileId !== undefined) await this.deleteFileRows([replacesFileId]);
        await this.connection.run(
          "INSERT INTO files VALUES ($1::INTEGER, $2, $3::BIGINT, $4::BIGINT, $5::INTEGER, $6)",
          [
            fileId,
            record.path,
            record.sizeBytes,
            record.modifiedMs,
            chunks.length,
            record.note ?? null,
          ],
        );
        await this.appendChunks(fileId, chunks, vectors);
      });
    } catch (error) {
      // A rolled-back transaction may have undone the passage table this object remembers.
      await this.loadState();
      throw error;
    }
    if (!this.madePrivateAfterWrite) {
      // The write-ahead log appears with the first write.
      await this.database.makePrivate();
      this.madePrivateAfterWrite = true;
    }
  }

  async removeFiles(fileIds: readonly number[]): Promise<void> {
    if (fileIds.length === 0) return;
    await this.inTransaction(() => this.deleteFileRows(fileIds));
  }

  /** Records when the run ended and whether it went through every file. */
  async finishRun(complete: boolean, now: Date): Promise<void> {
    await this.inTransaction(async () => {
      await this.setMeta("updated_at", now.toISOString());
      await this.setMeta("complete", String(complete));
    });
  }

  close(): Promise<void> {
    return this.database.close();
  }

  private async loadState(): Promise<void> {
    const meta = await this.readMeta();
    if (!meta) return;
    this.dimensions = meta.dimensions;
    const [row] = await this.rows("SELECT coalesce(max(file_id), 0) AS largest FROM files");
    this.nextFileId = Number(row?.largest ?? 0) + 1;
  }

  private async ensureChunkTable(dimensions: number): Promise<void> {
    if (this.dimensions === dimensions) return;
    if (this.dimensions !== undefined) {
      throw new Error(`The index holds ${this.dimensions}-number vectors, not ${dimensions}.`);
    }
    await this.connection.run(
      `CREATE TABLE chunks (file_id INTEGER, chunk_index INTEGER, start_line INTEGER, end_line INTEGER, page INTEGER, text VARCHAR, embedding FLOAT[${Math.trunc(dimensions)}])`,
    );
    await this.setMeta("dimensions", String(dimensions));
    this.dimensions = dimensions;
  }

  private async appendChunks(
    fileId: number,
    chunks: readonly Chunk[],
    vectors: readonly number[][],
  ): Promise<void> {
    if (chunks.length === 0 || this.dimensions === undefined) return;
    const { ARRAY, DuckDBDataChunk, FLOAT, INTEGER, VARCHAR, arrayValue } = await loadDuckDb();
    const columnTypes = [
      INTEGER,
      INTEGER,
      INTEGER,
      INTEGER,
      INTEGER,
      VARCHAR,
      ARRAY(FLOAT, this.dimensions),
    ];
    const appender = await this.connection.createAppender("chunks");
    try {
      for (let start = 0; start < chunks.length; start += rowsPerDataChunk) {
        const rows = chunks
          .slice(start, start + rowsPerDataChunk)
          .map((chunk, offset) => [
            fileId,
            start + offset,
            chunk.startLine,
            chunk.endLine,
            chunk.page ?? null,
            chunk.text,
            arrayValue(vectors[start + offset] as number[]),
          ]);
        const dataChunk = DuckDBDataChunk.create(columnTypes, rows.length);
        dataChunk.setRows(rows);
        appender.appendDataChunk(dataChunk);
      }
    } finally {
      appender.closeSync();
    }
  }

  private async deleteFileRows(fileIds: readonly number[]): Promise<void> {
    // Ids are numbers the store assigned itself, so they are safe to write into the SQL.
    const idList = fileIds.map((id) => Math.trunc(id)).join(", ");
    if (this.dimensions !== undefined) {
      await this.connection.run(`DELETE FROM chunks WHERE file_id IN (${idList})`);
    }
    await this.connection.run(`DELETE FROM files WHERE file_id IN (${idList})`);
  }

  private async setMeta(key: string, value: string): Promise<void> {
    await this.connection.run("DELETE FROM meta WHERE key = $1", [key]);
    await this.connection.run("INSERT INTO meta VALUES ($1, $2)", [key, value]);
  }

  private async tableExists(name: string): Promise<boolean> {
    const rows = await this.rows(
      "SELECT 1 AS found FROM information_schema.tables WHERE table_name = $1",
      [name],
    );
    return rows.length > 0;
  }

  private async rows(sql: string, values: string[] = []): Promise<Record<string, unknown>[]> {
    const reader = await this.connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJS();
  }

  private async inTransaction(work: () => Promise<void>): Promise<void> {
    await this.connection.run("BEGIN");
    try {
      await work();
      await this.connection.run("COMMIT");
    } catch (error) {
      await this.connection.run("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
}
