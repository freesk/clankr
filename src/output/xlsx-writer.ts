// Builds a new Excel workbook (.xlsx) with SheetJS 0.20.3, the library that already reads
// `.xls` (D36). It is loaded on first use. Cells are typed: numbers are numbers, and a column
// of ISO dates becomes real Excel dates, so sorting and formulas work on the file.

import type { CellObject } from "xlsx";
import { type JsonValue, ToolError } from "../contracts/index.ts";
import { isoDateToSerial } from "../shared/excel-dates.ts";
import type { ColumnKind, TableData } from "./table-data.ts";

export interface WorkbookSheet {
  /** Made valid and unique with `uniqueSheetNames`. */
  name: string;
  table: TableData;
}

/**
 * Built-in Excel number formats (ids 14 and 22). Excel shows them in the reader's own locale,
 * and DuckDB's Excel reader only recognises built-in date formats (ROADMAP task 24).
 */
const dateNumberFormat = "m/d/yy";
const dateTimeNumberFormat = "m/d/yy h:mm";

const maxSheetNameLength = 31;
/** Excel refuses a cell with more text than this. */
const maxCellCharacters = 32_767;
const maxColumnWidthCharacters = 60;
/** Rows looked at when sizing a column; more would only slow a large export down. */
const rowsMeasuredForWidth = 200;

/** Excel sheet names: at most 31 characters, none of \ / ? * [ ] :, no quote at either end, unique. */
export function uniqueSheetNames(wanted: string[]): string[] {
  const taken = new Set<string>();
  return wanted.map((name, index) => {
    const base = cleanSheetName(name) || `Sheet${index + 1}`;
    let candidate = base;
    for (let number = 2; taken.has(candidate.toLowerCase()); number++) {
      const suffix = ` (${number})`;
      candidate = base.slice(0, maxSheetNameLength - suffix.length) + suffix;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

function cleanSheetName(name: string): string {
  return name
    .replaceAll(/[\\/?*[\]:]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, maxSheetNameLength)
    .replaceAll(/^'+|'+$/g, "")
    .trim();
}

/** The workbook's bytes. Sheets keep the order given; each has a header row. */
export async function buildWorkbook(sheets: WorkbookSheet[]): Promise<Buffer> {
  const { utils, write } = await import("xlsx");
  const workbook = utils.book_new();
  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));
  for (const [index, sheet] of sheets.entries()) {
    const cells = sheetCells(sheet.table);
    const worksheet = utils.aoa_to_sheet(cells, { dense: true });
    worksheet["!cols"] = columnWidths(cells);
    utils.book_append_sheet(workbook, worksheet, names[index]);
  }
  try {
    return write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  } catch (error) {
    // SheetJS builds each sheet in memory; a very wide, very long one outgrows a string.
    if (!(error instanceof RangeError)) throw error;
    throw new ToolError(
      "The table is too large to write as one Excel workbook. Aggregate it with query_sql first, or export it as csv.",
    );
  }
}

type SheetCell = CellObject | null;

function sheetCells(table: TableData): SheetCell[][] {
  const header: SheetCell[] = table.columns.map((column) => ({ t: "s", v: column.name }));
  const body = table.rows.map((row) =>
    table.columns.map((column) => cellFor(row[column.name], column.kind)),
  );
  return [header, ...body];
}

function cellFor(value: JsonValue | undefined, kind: ColumnKind): SheetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return { t: "n", v: value };
  if (typeof value === "boolean") return { t: "b", v: value };
  if (typeof value !== "string") return textCell(JSON.stringify(value));
  if (kind !== "date" && kind !== "datetime") return textCell(value);
  const date = isoDateToSerial(value);
  if (!date) return textCell(value);
  return {
    t: "n",
    v: date.serial,
    z: kind === "date" ? dateNumberFormat : dateTimeNumberFormat,
  };
}

function textCell(text: string): SheetCell {
  return { t: "s", v: text.length > maxCellCharacters ? text.slice(0, maxCellCharacters) : text };
}

/** Wide enough for the header and the first rows, so nothing important starts out as "####". */
function columnWidths(cells: SheetCell[][]): { wch: number }[] {
  const measured = cells.slice(0, rowsMeasuredForWidth);
  const columnCount = cells[0]?.length ?? 0;
  return Array.from({ length: columnCount }, (_, column) => {
    const longest = Math.max(...measured.map((row) => displayLength(row[column])));
    return { wch: Math.min(Math.max(longest + 2, 8), maxColumnWidthCharacters) };
  });
}

function displayLength(cell: SheetCell | undefined): number {
  if (!cell) return 0;
  // A date serial such as 45306 prints as a ten-character date.
  if (cell.z) return 16;
  return String(cell.v).length;
}
