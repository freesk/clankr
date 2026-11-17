// Legacy `.xls` workbooks (D36). DuckDB cannot read them, so SheetJS reads each sheet
// and it is stored as a row set that DuckDB reads. The format caps a sheet at 65,536
// rows, so holding one sheet in memory is bounded.
//
// Dates: SheetJS turns date cells into JS Dates at local midnight, which shift when
// written as UTC (foundation spike). So cells are read as raw serial numbers and a
// date-formatted serial is converted here, in UTC, to an ISO date string.

import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { ToolError } from "../../../contracts/index.ts";
import { type CellText, detectHeaderRow, headerSearchRows } from "./header-detection.ts";
import { type CellValue, cellText, gridToRows, type RowGrid } from "./row-grid.ts";

export interface XlsSheet extends RowGrid {
  label: string;
  headerRow: number;
}

const millisecondsPerDay = 86_400_000;
/** Days from Excel's 1900 epoch (as Excel counts, with its 1900 leap-year bug) to 1970-01-01. */
const unixEpochSerial1900 = 25_569;
const epochShift1904 = 1_462;

/** `headerRowFor` returns the caller's header row for a sheet, if one was given. */
export async function readXlsSheets(
  path: string,
  headerRowFor: (sheet: string) => number | undefined,
): Promise<XlsSheet[]> {
  const workbook = parseWorkbook(await readFile(path));
  const uses1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const sheets: XlsSheet[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name] as XLSX.DenseSheet | undefined;
    // Dense rows are sparse arrays; Array.from fills the holes left by empty rows and cells.
    const grid = Array.from(sheet?.["!data"] ?? [], (cells) =>
      Array.from(cells ?? [], (cell) => cellValue(cell, uses1904)),
    );
    if (grid.every((cells) => cells.every((cell) => cellText(cell) === null))) continue;
    const headerRow =
      headerRowFor(name) ?? detectHeaderRow(grid.slice(0, headerSearchRows).map(textRow));
    sheets.push({ label: name, headerRow, ...gridToRows(grid, headerRow) });
  }
  return sheets;
}

function parseWorkbook(bytes: Buffer): XLSX.WorkBook {
  try {
    return XLSX.read(bytes, { type: "buffer", dense: true, cellDates: false, cellNF: true });
  } catch {
    throw new ToolError(
      "This .xls file could not be read. It may be damaged or password-protected.",
    );
  }
}

function textRow(cells: CellValue[]): CellText[] {
  return cells.map(cellText);
}

function cellValue(cell: XLSX.CellObject | undefined, uses1904: boolean): CellValue {
  if (!cell || cell.v === undefined || cell.t === "z" || cell.t === "e") return null;
  if (cell.t === "n" && typeof cell.v === "number" && isDateFormat(cell.z)) {
    return serialToIsoDate(cell.v, uses1904);
  }
  if (cell.v instanceof Date) return cell.v.toISOString();
  return cell.v;
}

function isDateFormat(format: XLSX.NumberFormat | undefined): boolean {
  if (format === undefined) return false;
  return XLSX.SSF.is_date(format) === true;
}

/** Whole days become "2024-01-15"; a time of day adds " 10:30:00". */
export function serialToIsoDate(serial: number, uses1904: boolean): string {
  const daysSince1970 = serial - unixEpochSerial1900 + (uses1904 ? epochShift1904 : 0);
  const milliseconds = Math.round(daysSince1970 * millisecondsPerDay);
  const iso = new Date(milliseconds).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return time === "00:00:00" ? date : `${date} ${time}`;
}
