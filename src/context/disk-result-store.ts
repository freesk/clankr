// The on-disk ResultStore. Each result is a data file (text, or JSON Lines for row sets)
// plus a small metadata file. The metadata file is written last, so a result without one
// was interrupted mid-write and is never served.

import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import type {
  ResultHandle,
  ResultMeta,
  ResultProvenance,
  ResultStore,
  Row,
  TextRange,
} from "../contracts/index.ts";
import { handleFromNumber, isResultHandle } from "./handles.ts";
import {
  dataFileName,
  ensurePrivateDirectory,
  highestStoredHandleNumber,
  metaFilePath,
  privateFileMode,
  readLines,
} from "./result-files.ts";

/** Thrown for a handle that is malformed or names no stored result. */
export class UnknownResultError extends Error {
  override readonly name = "UnknownResultError";
  readonly handle: string;

  constructor(handle: string) {
    super(`No stored result ${handle}`);
    this.handle = handle;
  }
}

export class DiskResultStore implements ResultStore {
  private readonly directory: string;
  private readonly metaCache = new Map<ResultHandle, ResultMeta>();
  private ready: Promise<void> | undefined;
  private nextNumber = 1;

  /** `directory` is `VixPaths.session.results`. */
  constructor(directory: string) {
    this.directory = directory;
  }

  async putText(text: string, provenance: ResultProvenance): Promise<ResultHandle> {
    const handle = await this.reserveHandle();
    await writeFile(join(this.directory, dataFileName(handle, "text")), text, {
      mode: privateFileMode,
    });
    const lineCount = text.split("\n").length;
    await this.writeMeta(buildMeta(handle, "text", provenance, Buffer.byteLength(text), lineCount));
    return handle;
  }

  async putRows(
    rows: AsyncIterable<Row> | Iterable<Row>,
    provenance: ResultProvenance,
  ): Promise<ResultHandle> {
    const handle = await this.reserveHandle();
    const filePath = join(this.directory, dataFileName(handle, "rows"));
    const output = createWriteStream(filePath, { mode: privateFileMode });
    const columns = new Set<string>();
    let rowCount = 0;
    let sizeBytes = 0;
    try {
      for await (const row of rows) {
        // JSON.stringify turns a Date into an ISO string, which is the stored date format.
        const line = `${JSON.stringify(row)}\n`;
        for (const column of Object.keys(row)) columns.add(column);
        rowCount += 1;
        sizeBytes += Buffer.byteLength(line);
        if (!output.write(line)) await once(output, "drain");
      }
    } finally {
      output.end();
      await finished(output);
    }
    const meta = buildMeta(handle, "rows", provenance, sizeBytes, rowCount);
    meta.columns = [...columns];
    await this.writeMeta(meta);
    return handle;
  }

  /** Reads text results by line. A row set reads as its JSON Lines, one row per line. */
  async readText(handle: ResultHandle, range: TextRange): Promise<string> {
    const meta = await this.describe(handle);
    const firstLine = Math.max(range.startLine, 1);
    const lastLine = firstLine + Math.max(range.lineCount, 0) - 1;
    const selected: string[] = [];
    if (lastLine < firstLine) return "";
    let lineNumber = 0;
    for await (const line of readLines(this.dataFilePath(meta))) {
      lineNumber += 1;
      if (lineNumber >= firstLine) selected.push(line);
      if (lineNumber >= lastLine) break;
    }
    return selected.join("\n");
  }

  async *readRows(handle: ResultHandle, limit?: number): AsyncIterable<Row> {
    const meta = await this.describe(handle);
    if (meta.kind !== "rows") throw new Error(`Result ${handle} holds text, not rows`);
    const maximum = limit ?? Number.POSITIVE_INFINITY;
    let yielded = 0;
    if (maximum <= 0) return;
    for await (const line of readLines(this.dataFilePath(meta))) {
      if (line.length === 0) continue;
      yield JSON.parse(line) as Row;
      yielded += 1;
      if (yielded >= maximum) return;
    }
  }

  async describe(handle: ResultHandle): Promise<ResultMeta> {
    const cached = this.metaCache.get(handle);
    if (cached) return cached;
    if (!isResultHandle(handle)) throw new UnknownResultError(handle);
    let meta: ResultMeta;
    try {
      meta = JSON.parse(await readFile(metaFilePath(this.directory, handle), "utf8"));
    } catch {
      throw new UnknownResultError(handle);
    }
    this.metaCache.set(handle, meta);
    return meta;
  }

  rowsFilePath(handle: ResultHandle): string | undefined {
    if (!isResultHandle(handle)) return undefined;
    const filePath = join(this.directory, dataFileName(handle, "rows"));
    const complete = existsSync(metaFilePath(this.directory, handle));
    return complete && existsSync(filePath) ? filePath : undefined;
  }

  private dataFilePath(meta: ResultMeta): string {
    return join(this.directory, dataFileName(meta.handle, meta.kind));
  }

  /** Numbers are taken synchronously after start-up, so concurrent puts never share one. */
  private async reserveHandle(): Promise<ResultHandle> {
    this.ready ??= this.start();
    await this.ready;
    return handleFromNumber(this.nextNumber++);
  }

  private async start(): Promise<void> {
    await ensurePrivateDirectory(this.directory);
    this.nextNumber = (await highestStoredHandleNumber(this.directory)) + 1;
  }

  private async writeMeta(meta: ResultMeta): Promise<void> {
    await writeFile(metaFilePath(this.directory, meta.handle), JSON.stringify(meta), {
      mode: privateFileMode,
    });
    this.metaCache.set(meta.handle, meta);
  }
}

function buildMeta(
  handle: ResultHandle,
  kind: ResultMeta["kind"],
  provenance: ResultProvenance,
  sizeBytes: number,
  itemCount: number,
): ResultMeta {
  return { ...provenance, handle, kind, sizeBytes, itemCount, createdAt: new Date().toISOString() };
}
