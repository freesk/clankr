// Turning a grid of cells (an `.xls` sheet, a `.docx` table) into rows for a stored
// row set that DuckDB reads (D16, D17, D36). Each column ends up with one JSON type,
// so DuckDB infers a clean type; a column mixing types is stored as text and the
// profile reports it as mixed.

import type { JsonValue, Row } from "../../../contracts/index.ts";
import type { CellText } from "./header-detection.ts";

export type CellValue = string | number | boolean | null;

export interface RowGrid {
  columns: string[];
  rows: Row[];
}

/** The rows below `headerRow` (1-based), keyed by the header's labels. Empty rows are dropped. */
export function gridToRows(grid: CellValue[][], headerRow: number): RowGrid {
  const width = Math.max(0, ...grid.map((row) => row.length));
  const columns = headerNames((grid[headerRow - 1] ?? []).map(cellText), width);
  const rows: Row[] = [];
  for (const cells of grid.slice(headerRow)) {
    if (!cells.some((cell) => cellText(cell) !== null)) continue;
    const row: Row = {};
    columns.forEach((column, index) => {
      row[column] = emptyToNull(cells[index] ?? null);
    });
    rows.push(row);
  }
  return { columns, rows: withOneTypePerColumn(columns, rows) };
}

export function cellText(cell: CellValue): CellText {
  if (cell === null) return null;
  const text = String(cell).trim();
  return text === "" ? null : text;
}

/** Labels for SQL: blanks become column_N, repeats get a numeric suffix. */
export function headerNames(labels: CellText[], width: number): string[] {
  const used = new Set<string>();
  const names: string[] = [];
  for (let index = 0; index < width; index++) {
    const label = labels[index]?.replace(/\s+/g, " ").trim() || `column_${index + 1}`;
    let name = label;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${label}_${suffix}`;
    used.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

function emptyToNull(cell: CellValue): JsonValue {
  return typeof cell === "string" && cell.trim() === "" ? null : cell;
}

function withOneTypePerColumn(columns: string[], rows: Row[]): Row[] {
  const mixedColumns = columns.filter((column) => {
    const types = new Set(
      rows
        .map((row) => row[column])
        .filter((value) => value !== null)
        .map((value) => typeof value),
    );
    return types.size > 1;
  });
  for (const row of rows) {
    for (const column of mixedColumns) {
      const value = row[column];
      if (value !== null && value !== undefined) row[column] = String(value);
    }
  }
  return rows;
}

/**
 * Text cells that all read as plain numbers become numbers, column by column.
 * Used for `.docx` tables, where every cell is text. A column with any other text stays text.
 */
export function numbersFromText(grid: RowGrid): RowGrid {
  for (const column of grid.columns) {
    const values = grid.rows.map((row) => row[column]).filter((value) => value !== null);
    if (values.length === 0 || !values.every((value) => parsePlainNumber(value) !== undefined)) {
      continue;
    }
    for (const row of grid.rows) {
      const value = row[column];
      if (value !== null && value !== undefined) row[column] = parsePlainNumber(value) ?? value;
    }
  }
  return grid;
}

/** "1,234.5" and "-12" are numbers; "12%", "$5", and "1.2.3" are not. */
function parsePlainNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(text)) return undefined;
  return Number(text.replaceAll(",", ""));
}
