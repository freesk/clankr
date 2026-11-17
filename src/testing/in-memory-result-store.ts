// A ResultStore kept in memory, for testing tools that store large results.

import type {
  ResultHandle,
  ResultMeta,
  ResultProvenance,
  ResultStore,
  Row,
  TextRange,
} from "../contracts/index.ts";

interface StoredResult {
  meta: ResultMeta;
  lines?: string[];
  rows?: Row[];
}

export class InMemoryResultStore implements ResultStore {
  private readonly stored = new Map<ResultHandle, StoredResult>();
  private nextNumber = 1;

  async putText(text: string, provenance: ResultProvenance): Promise<ResultHandle> {
    const lines = text.split("\n");
    const meta = this.buildMeta("text", provenance, Buffer.byteLength(text), lines.length);
    this.stored.set(meta.handle, { meta, lines });
    return meta.handle;
  }

  async putRows(
    rows: AsyncIterable<Row> | Iterable<Row>,
    provenance: ResultProvenance,
  ): Promise<ResultHandle> {
    const collected: Row[] = [];
    for await (const row of rows) collected.push(row);
    const sizeBytes = collected.reduce(
      (sum, row) => sum + Buffer.byteLength(JSON.stringify(row)) + 1,
      0,
    );
    const meta = this.buildMeta("rows", provenance, sizeBytes, collected.length);
    meta.columns = Object.keys(collected[0] ?? {});
    this.stored.set(meta.handle, { meta, rows: collected });
    return meta.handle;
  }

  async readText(handle: ResultHandle, range: TextRange): Promise<string> {
    const lines = this.get(handle).lines;
    if (!lines) throw new Error(`Result ${handle} holds rows, not text`);
    const start = Math.max(range.startLine, 1) - 1;
    return lines.slice(start, start + range.lineCount).join("\n");
  }

  async *readRows(handle: ResultHandle, limit?: number): AsyncIterable<Row> {
    const rows = this.get(handle).rows;
    if (!rows) throw new Error(`Result ${handle} holds text, not rows`);
    yield* rows.slice(0, limit ?? rows.length);
  }

  async describe(handle: ResultHandle): Promise<ResultMeta> {
    return this.get(handle).meta;
  }

  /** Every stored handle, in creation order. */
  handles(): ResultHandle[] {
    return [...this.stored.keys()];
  }

  private get(handle: ResultHandle): StoredResult {
    const result = this.stored.get(handle);
    if (!result) throw new Error(`Unknown result handle ${handle}`);
    return result;
  }

  private buildMeta(
    kind: ResultMeta["kind"],
    provenance: ResultProvenance,
    sizeBytes: number,
    itemCount: number,
  ): ResultMeta {
    const handle = `r${this.nextNumber++}`;
    return {
      ...provenance,
      handle,
      kind,
      sizeBytes,
      itemCount,
      createdAt: new Date().toISOString(),
    };
  }
}
