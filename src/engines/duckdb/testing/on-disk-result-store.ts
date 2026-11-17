// Test fake: a ResultStore that writes row sets as JSON Lines files, so DuckDB can read
// them through `rowsFilePath`, as it will with context's real store. The shared
// InMemoryResultStore has no files. Test code only; move to src/testing/ at integration.

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ResultHandle,
  ResultMeta,
  ResultProvenance,
  ResultStore,
  Row,
  TextRange,
} from "../../../contracts/index.ts";

export class OnDiskResultStore implements ResultStore {
  private readonly metas = new Map<ResultHandle, ResultMeta>();
  private nextNumber = 1;

  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async putText(text: string, provenance: ResultProvenance): Promise<ResultHandle> {
    const meta = this.newMeta("text", provenance);
    await writeFile(this.filePath(meta.handle), text);
    meta.sizeBytes = Buffer.byteLength(text);
    meta.itemCount = text.split("\n").length;
    return meta.handle;
  }

  async putRows(
    rows: AsyncIterable<Row> | Iterable<Row>,
    provenance: ResultProvenance,
  ): Promise<ResultHandle> {
    const meta = this.newMeta("rows", provenance);
    const path = this.filePath(meta.handle);
    await writeFile(path, "");
    let batch = "";
    for await (const row of rows) {
      meta.columns ??= Object.keys(row);
      const line = `${JSON.stringify(row)}\n`;
      batch += line;
      meta.sizeBytes += Buffer.byteLength(line);
      meta.itemCount++;
      if (batch.length > 1_000_000) {
        await appendFile(path, batch);
        batch = "";
      }
    }
    await appendFile(path, batch);
    return meta.handle;
  }

  async readText(handle: ResultHandle, range: TextRange): Promise<string> {
    const lines = (await readFile(this.filePath(handle), "utf8")).split("\n");
    const start = Math.max(range.startLine, 1) - 1;
    return lines.slice(start, start + range.lineCount).join("\n");
  }

  async *readRows(handle: ResultHandle, limit?: number): AsyncIterable<Row> {
    const lines = (await readFile(this.filePath(handle), "utf8")).split("\n").filter(Boolean);
    for (const line of lines.slice(0, limit ?? lines.length)) yield JSON.parse(line) as Row;
  }

  async describe(handle: ResultHandle): Promise<ResultMeta> {
    const meta = this.metas.get(handle);
    if (!meta) throw new Error(`Unknown result handle ${handle}`);
    return meta;
  }

  rowsFilePath(handle: ResultHandle): string | undefined {
    return this.metas.get(handle)?.kind === "rows" ? this.filePath(handle) : undefined;
  }

  handles(): ResultHandle[] {
    return [...this.metas.keys()];
  }

  private filePath(handle: ResultHandle): string {
    return join(this.directory, `${handle}.jsonl`);
  }

  private newMeta(kind: ResultMeta["kind"], provenance: ResultProvenance): ResultMeta {
    const meta: ResultMeta = {
      ...provenance,
      handle: `r${this.nextNumber++}`,
      kind,
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      itemCount: 0,
    };
    this.metas.set(meta.handle, meta);
    return meta;
  }
}
