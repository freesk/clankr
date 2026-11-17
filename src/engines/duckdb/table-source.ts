// The SQL expression that reads one registered table. Both callers use it: the session
// engine wraps it in a view named after the table, and inspect profiles through it,
// so SQL always reads a table exactly the way inspection did.

import type { DataFormat, DataTable, TableLayout } from "../../contracts/index.ts";
import { quoteLiteral } from "./sql-text.ts";

export interface TableSourceInput {
  format: DataFormat;
  realPath: string;
  table: DataTable;
  /** The row set's file, for tables extracted into the result store (`.docx`, `.xls`). */
  rowsFilePath?: string;
}

/** The one file DuckDB must be allowed to open to read this table. */
export function fileReadBy(input: TableSourceInput): string {
  if (input.table.rowsHandle) return requireRowsFile(input);
  return input.table.layout?.utf8CopyPath ?? input.realPath;
}

/**
 * How an `.xlsx` sheet is read. SQL always uses "lenient": a cell that does not fit its
 * column's type becomes NULL. Inspect also uses "strict" (fails on such a cell) and
 * "text" (every cell as text) to find mixed columns.
 */
export type XlsxReadMode = "lenient" | "strict" | "text";

export function tableSourceSql(
  input: TableSourceInput,
  options: { xlsxMode?: XlsxReadMode } = {},
): string {
  if (input.table.rowsHandle) return readRowSetSql(requireRowsFile(input));
  const layout = input.table.layout ?? { headerRow: 1 };
  if (input.format === "csv" || input.format === "tsv") {
    return readDelimitedSql(input.realPath, layout, input.format);
  }
  if (input.format === "xlsx") {
    return readXlsxSql(input.realPath, layout, options.xlsxMode ?? "lenient");
  }
  throw new Error(`A ${input.format} table must be read from a stored row set`);
}

export function readsExcel(input: TableSourceInput): boolean {
  return input.format === "xlsx" && !input.table.rowsHandle;
}

function requireRowsFile(input: TableSourceInput): string {
  if (!input.rowsFilePath) {
    throw new Error(`No file on disk for row set ${input.table.rowsHandle}`);
  }
  return input.rowsFilePath;
}

function readRowSetSql(rowsFilePath: string): string {
  return `read_json(${quoteLiteral(rowsFilePath)}, format = 'newline_delimited')`;
}

function readDelimitedSql(path: string, layout: TableLayout, format: "csv" | "tsv"): string {
  const delimiter = layout.delimiter ?? (format === "tsv" ? "\t" : ",");
  const options = [
    `delim = ${quoteLiteral(delimiter)}`,
    "header = true",
    `skip = ${layout.headerRow - 1}`,
  ];
  if (layout.scanAllRowsForTypes) options.push("sample_size = -1");
  return `read_csv(${quoteLiteral(layout.utf8CopyPath ?? path)}, ${options.join(", ")})`;
}

/**
 * A range with an end row ("A3:F1200") is read whole, blank rows included. An open range
 * ("A3:F") would be padded to the sheet's maximum of 1,048,576 rows, so it stops at the
 * first empty row instead.
 */
function readXlsxSql(path: string, layout: TableLayout, mode: XlsxReadMode): string {
  const hasEndRow = layout.cellRange === undefined || /\d$/.test(layout.cellRange);
  const options = [
    "header = true",
    `ignore_errors = ${mode !== "strict"}`,
    `stop_at_empty = ${!hasEndRow}`,
  ];
  if (mode === "text") options.push("all_varchar = true");
  if (layout.sheet !== undefined) options.push(`sheet = ${quoteLiteral(layout.sheet)}`);
  if (layout.cellRange !== undefined) options.push(`range = ${quoteLiteral(layout.cellRange)}`);
  return `read_xlsx(${quoteLiteral(path)}, ${options.join(", ")})`;
}
