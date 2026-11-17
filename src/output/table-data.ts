// A stored row set as a table: its columns in order and what each holds. Row sets are JSON
// (D16), so dates arrive as ISO text; a column is a date column only when every value in it
// is one, which keeps a stray date-like string in a text column as text.

import type { JsonValue, Row } from "../contracts/index.ts";
import { isoDateToSerial } from "../shared/excel-dates.ts";

export type ColumnKind = "number" | "date" | "datetime" | "other";

export interface TableColumn {
  name: string;
  kind: ColumnKind;
}

export interface TableData {
  columns: TableColumn[];
  rows: Row[];
}

/** `knownColumns` is the stored column order; without it, the keys in order of first use. */
export function describeTable(rows: Row[], knownColumns?: string[]): TableData {
  const names = knownColumns && knownColumns.length > 0 ? knownColumns : columnNamesOf(rows);
  return { columns: names.map((name) => ({ name, kind: columnKind(name, rows) })), rows };
}

function columnNamesOf(rows: Row[]): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const name of Object.keys(row)) names.add(name);
  return [...names];
}

function columnKind(name: string, rows: Row[]): ColumnKind {
  let kind: ColumnKind | undefined;
  for (const row of rows) {
    const value = row[name];
    if (value === null || value === undefined) continue;
    const valueKind = kindOfValue(value);
    if (valueKind === "other") return "other";
    if (kind === undefined) kind = valueKind;
    else if (kind !== valueKind) {
      // Dates with and without a time of day share a column as date-times; anything else mixes.
      if (kind === "number" || valueKind === "number") return "other";
      kind = "datetime";
    }
  }
  return kind ?? "other";
}

function kindOfValue(value: JsonValue): ColumnKind {
  if (typeof value === "number") return "number";
  if (typeof value !== "string") return "other";
  const date = isoDateToSerial(value);
  if (!date) return "other";
  return date.hasTime ? "datetime" : "date";
}

/** A value as a reader sees it in a Word table, a PDF table, or a CSV field. */
export function cellText(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Every row as text cells, in column order. */
export function textGrid(table: TableData): string[][] {
  return table.rows.map((row) => table.columns.map((column) => cellText(row[column.name])));
}
