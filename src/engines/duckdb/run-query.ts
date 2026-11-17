// Running a query with a timeout that really stops it, and reading its rows as a stream.
// DuckDB runs on its own threads, so the event loop stays free to fire the timer;
// `interrupt()` then makes the running query fail with an INTERRUPT error.

import type { DuckDBConnection, DuckDBResult } from "@duckdb/node-api";
import type { Row } from "../../contracts/index.ts";
import { loadDuckDb } from "./load-duckdb.ts";
import { createRowValueConverter, rowFromValues } from "./value-conversion.ts";

export interface QueryLimits {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Why a query was interrupted, so the caller can say so instead of showing DuckDB's text. */
export class QueryInterruptedError extends Error {
  readonly reason: "timeout" | "cancelled";

  constructor(reason: "timeout" | "cancelled") {
    super(reason === "timeout" ? "Query timed out" : "Query cancelled");
    this.reason = reason;
  }
}

/**
 * Runs `work` (which may start a query and read all of its rows) under the limits.
 * When the time runs out or the signal fires, the connection is interrupted.
 */
export async function withQueryLimits<T>(
  connection: DuckDBConnection,
  limits: QueryLimits,
  work: () => Promise<T>,
): Promise<T> {
  let interruptedFor: QueryInterruptedError["reason"] | undefined;
  const interrupt = (reason: QueryInterruptedError["reason"]) => {
    interruptedFor ??= reason;
    connection.interrupt();
  };
  const timer = setTimeout(() => interrupt("timeout"), limits.timeoutMs);
  const onAbort = () => interrupt("cancelled");
  limits.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (limits.signal?.aborted) throw new QueryInterruptedError("cancelled");
    return await work();
  } catch (error) {
    if (interruptedFor) throw new QueryInterruptedError(interruptedFor);
    throw error;
  } finally {
    clearTimeout(timer);
    limits.signal?.removeEventListener("abort", onAbort);
  }
}

export interface RowStream {
  columns: string[];
  rows: AsyncGenerator<Row>;
}

/** Starts a streaming query. Rows are converted chunk by chunk, never all at once. */
export async function streamRows(connection: DuckDBConnection, sql: string): Promise<RowStream> {
  const duckdb = await loadDuckDb();
  const result = await connection.stream(sql);
  const columns = result.deduplicatedColumnNames();
  return { columns, rows: convertChunks(result, columns, createRowValueConverter(duckdb)) };
}

async function* convertChunks(
  result: DuckDBResult,
  columns: string[],
  converter: ReturnType<typeof createRowValueConverter>,
): AsyncGenerator<Row> {
  for (;;) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) return;
    for (const values of chunk.convertRows(converter)) yield rowFromValues(columns, values);
  }
}

/** Every row of a small, harness-written query (profiling, schema lookups). */
export async function readAllRows(connection: DuckDBConnection, sql: string): Promise<Row[]> {
  const { rows } = await streamRows(connection, sql);
  const collected: Row[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
}
