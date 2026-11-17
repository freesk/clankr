// Storing large results behind a handle (seam: context → search, sql, sandbox, chart, inspect).

/** Short id the model repeats, for example "r12". Kept short because every character costs tokens. */
export type ResultHandle = string;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** One row of a stored row set. Row sets are stored as JSON Lines (D16). */
export type Row = Record<string, JsonValue>;

/** Which tool call produced a result. Chart needs it to save the SQL beside the output (DATA-20). */
export interface ResultProvenance {
  tool: string;
  arguments: Record<string, unknown>;
  /** Short human label, for example "find_files *.pdf under ~/Documents". */
  label?: string;
  /** Real paths of the data files the result was computed from (chart puts its output beside the first). */
  dataSourcePaths?: string[];
}

export interface ResultMeta extends ResultProvenance {
  handle: ResultHandle;
  kind: "text" | "rows";
  createdAt: string;
  sizeBytes: number;
  /** Lines for text results, rows for row sets. */
  itemCount: number;
  /** Column names, for row sets. */
  columns?: string[];
}

/** Lines are 1-based. */
export interface TextRange {
  startLine: number;
  lineCount: number;
}

export interface ResultStore {
  putText(text: string, provenance: ResultProvenance): Promise<ResultHandle>;
  putRows(
    rows: AsyncIterable<Row> | Iterable<Row>,
    provenance: ResultProvenance,
  ): Promise<ResultHandle>;
  readText(handle: ResultHandle, range: TextRange): Promise<string>;
  readRows(handle: ResultHandle, limit?: number): AsyncIterable<Row>;
  describe(handle: ResultHandle): Promise<ResultMeta>;
  /** Where a row set lives on disk, so DuckDB can read it directly. Undefined for in-memory stores. */
  rowsFilePath?(handle: ResultHandle): string | undefined;
}
