// Planning the tables of an `.xlsx` workbook: one per sheet with cells. The sheet's
// recorded used range bounds the read; files that record none (some generators, DuckDB
// itself) are measured from their first rows and read until the first empty row.

import type { DuckDBConnection } from "@duckdb/node-api";
import { quoteLiteral, readAllRows } from "../../../engines/duckdb/index.ts";
import { type CellRange, columnLetters, formatCellRange, parseCellRange } from "./cell-range.ts";
import { type CellText, detectHeaderRow, headerSearchRows } from "./header-detection.ts";
import { cellText } from "./row-grid.ts";
import type { HeaderRowFor, TablePlan } from "./table-plans.ts";
import { readWorkbookSheets, type WorkbookSheet } from "./xlsx-workbook.ts";

/** Searched for the header when a sheet records no used range: up to 702 columns. */
const unboundedSearchRange = "A1:ZZ";

export async function planXlsx(
  connection: DuckDBConnection,
  realPath: string,
  headerRowFor: HeaderRowFor,
): Promise<TablePlan[]> {
  const plans: TablePlan[] = [];
  for (const sheet of await readWorkbookSheets(realPath)) {
    const plan = await planSheet(connection, realPath, sheet, headerRowFor);
    if (plan) plans.push(plan);
  }
  return plans;
}

async function planSheet(
  connection: DuckDBConnection,
  realPath: string,
  sheet: WorkbookSheet,
  headerRowFor: HeaderRowFor,
): Promise<TablePlan | undefined> {
  // A sheet whose used range is one cell ("A1") is empty, or at least not a table.
  if (sheet.dimension !== undefined && !sheet.dimension.includes(":")) return undefined;
  const recorded = sheet.dimension ? parseCellRange(sheet.dimension) : undefined;
  const searchRange = recorded ? boundedSearchRange(recorded) : unboundedSearchRange;
  const textRows = await readFirstRows(connection, realPath, sheet.name, searchRange);
  const firstRow = recorded?.firstRow ?? 1;
  const firstColumn = recorded?.firstColumn ?? 1;
  const lastColumn = recorded?.lastColumn ?? firstColumn - 1 + lastFilledColumn(textRows);
  if (lastColumn < firstColumn) return undefined;

  const headerRow = headerRowFor(sheet.name) ?? firstRow - 1 + detectHeaderRow(textRows);
  const cellRange = recorded
    ? formatCellRange({ ...recorded, firstRow: headerRow })
    : `${columnLetters(firstColumn)}${headerRow}:${columnLetters(lastColumn)}`;
  const rowsBelowHeader = textRows.slice(headerRow - firstRow + 1);
  return {
    label: sheet.name,
    description: `sheet "${sheet.name}"`,
    headerRow,
    layout: { headerRow, sheet: sheet.name, cellRange },
    hasData: recorded
      ? recorded.lastRow > headerRow
      : rowsBelowHeader.some((cells) => cells.some((cell) => cell !== null)),
  };
}

function boundedSearchRange(recorded: CellRange): string {
  const { firstColumn, firstRow, lastColumn } = recorded;
  return `${columnLetters(firstColumn)}${firstRow}:${columnLetters(lastColumn)}`;
}

/**
 * The search range has no end row on purpose: the reader stops early under LIMIT for an
 * open range, but scans the whole sheet for a range ending at row 30 (measured: 4 s on a
 * 76 MB file, against 0.4 s).
 */
async function readFirstRows(
  connection: DuckDBConnection,
  realPath: string,
  sheetName: string,
  range: string,
): Promise<CellText[][]> {
  const rows = await readAllRows(
    connection,
    `SELECT * FROM read_xlsx(${quoteLiteral(realPath)}, sheet = ${quoteLiteral(sheetName)}, header = false, all_varchar = true, stop_at_empty = false, range = ${quoteLiteral(range)}) LIMIT ${headerSearchRows}`,
  );
  return rows.map((row) =>
    Object.values(row).map((value) => (typeof value === "string" ? cellText(value) : null)),
  );
}

/** 1-based index of the rightmost column with any value, or 0. */
function lastFilledColumn(rows: CellText[][]): number {
  let last = 0;
  for (const cells of rows) {
    cells.forEach((cell, index) => {
      if (cell !== null) last = Math.max(last, index + 1);
    });
  }
  return last;
}
