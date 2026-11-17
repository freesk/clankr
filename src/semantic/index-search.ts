// The query side of one index: brute-force cosine similarity between the query vector and
// every stored passage vector, in DuckDB itself (`array_cosine_similarity` is built in; no
// extension). At 20,000 passages this takes tens of milliseconds, so no vector index is kept.

import { loadDuckDb } from "../engines/duckdb/load-duckdb.ts";
import type { IndexStore } from "./index-store.ts";

/** A stored passage with its similarity to the query, and the file as it was when indexed. */
export interface StoredPassage {
  /** Relative to the index root, with "/" separators. */
  path: string;
  indexedSizeBytes: number;
  indexedModifiedMs: number;
  startLine: number;
  endLine: number;
  page: number | undefined;
  text: string;
  /** Cosine similarity, -1..1. */
  score: number;
}

export interface PassageQuery {
  vector: readonly number[];
  /** Most passages to return. */
  limit: number;
  /** Most passages from one file, so one long document cannot fill the list. */
  perFile: number;
  /** Only files at or under this path (relative to the root). Absent searches everything. */
  under?: string;
}

export async function searchPassages(
  store: IndexStore,
  query: PassageQuery,
): Promise<StoredPassage[]> {
  const { ARRAY, FLOAT, arrayValue } = await loadDuckDb();
  const dimensions = query.vector.length;
  const scopeFilter =
    query.under === undefined ? "" : "AND (f.path = $4 OR starts_with(f.path, $5))";
  const statement = await store.connection.prepare(`
    SELECT f.path, f.size_bytes, f.modified_ms, c.start_line, c.end_line, c.page, c.text, c.score
    FROM (
      SELECT file_id, start_line, end_line, page, text,
             array_cosine_similarity(embedding, $1::FLOAT[${Math.trunc(dimensions)}]) AS score
      FROM chunks
    ) c
    JOIN files f USING (file_id)
    WHERE NOT isnan(c.score) ${scopeFilter}
    QUALIFY row_number() OVER (PARTITION BY c.file_id ORDER BY c.score DESC) <= $2
    ORDER BY c.score DESC, f.path, c.start_line
    LIMIT $3
  `);
  statement.bindArray(1, arrayValue([...query.vector]), ARRAY(FLOAT, dimensions));
  statement.bindInteger(2, query.perFile);
  statement.bindInteger(3, query.limit);
  if (query.under !== undefined) {
    statement.bindVarchar(4, query.under);
    statement.bindVarchar(5, `${query.under}/`);
  }
  const reader = await statement.runAndReadAll();
  return reader.getRowObjectsJS().map((row) => ({
    path: String(row.path),
    indexedSizeBytes: Number(row.size_bytes),
    indexedModifiedMs: Number(row.modified_ms),
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    page: row.page === null ? undefined : Number(row.page),
    text: String(row.text),
    score: Number(row.score),
  }));
}
