// Working out which tables a file holds and where each one's header is, before profiling.
// `.csv` and `.tsv` (here) and `.xlsx` (xlsx-plan.ts) are read in place by DuckDB, so
// their plans carry a layout. `.xls` sheets and `.docx` tables are converted to rows,
// stored as row sets.

import { basename } from "node:path";
import type { TableLayout } from "../../../contracts/index.ts";
import { ToolError } from "../../../contracts/index.ts";
import type { DetectedFormat } from "./detect-format.ts";
import { readDocxStructure } from "./docx-document.ts";
import { detectHeaderRow, headerSearchRows } from "./header-detection.ts";
import { cellText, gridToRows, numbersFromText, type RowGrid } from "./row-grid.ts";
import { readXlsSheets } from "./xls-conversion.ts";

export interface TablePlan {
  /** Sheet or table label, used to name the SQL table. */
  label: string;
  /** For the profile, for example `sheet "Plan"`. */
  description: string;
  headerRow?: number;
  /** For tables DuckDB reads in place. */
  layout?: TableLayout;
  /** For tables stored as row sets. */
  rows?: RowGrid;
  /** False when there is a header but no data under it. */
  hasData: boolean;
}

export type HeaderRowFor = (label: string) => number | undefined;

/**
 * Header detection works on the physical lines, blank ones included, because DuckDB's
 * `skip` counts physical lines (its own reader drops blank lines).
 */
export function planDelimited(
  realPath: string,
  detected: DetectedFormat,
  headerRowFor: HeaderRowFor,
  utf8CopyPath?: string,
): TablePlan[] {
  const label = basename(realPath);
  const delimiter = detected.delimiter ?? (detected.format === "tsv" ? "\t" : ",");
  const textRows = (detected.firstLines ?? [])
    .slice(0, headerSearchRows)
    .map((line) => splitDelimitedLine(line, delimiter).map(cellText));
  const headerRow = headerRowFor(label) ?? detectHeaderRow(textRows);
  const separated = detected.format === "tsv" ? "tab-separated" : "comma-separated";
  return [
    {
      label,
      description: utf8CopyPath ? `${separated}, Windows-1252 text read as UTF-8` : separated,
      headerRow,
      layout: { headerRow, delimiter, ...(utf8CopyPath ? { utf8CopyPath } : {}) },
      hasData: textRows.slice(headerRow).some((cells) => cells.some((cell) => cell !== null)),
    },
  ];
}

export async function planXls(realPath: string, headerRowFor: HeaderRowFor): Promise<TablePlan[]> {
  return (await readXlsSheets(realPath, headerRowFor)).map((sheet) => ({
    label: sheet.label,
    description: `sheet "${sheet.label}"`,
    headerRow: sheet.headerRow,
    rows: { columns: sheet.columns, rows: sheet.rows },
    hasData: sheet.rows.length > 0,
  }));
}

export async function planDocx(
  realPath: string,
  headerRowFor: HeaderRowFor,
): Promise<{ plans: TablePlan[]; headings: { level: number; text: string }[] }> {
  const structure = await readDocxStructure(realPath);
  const plans = structure.tables.map((table): TablePlan => {
    const label = `table ${table.number}`;
    const headerRow =
      headerRowFor(label) ??
      detectHeaderRow(table.grid.slice(0, headerSearchRows).map((row) => row.map(cellText)));
    const rows = numbersFromText(gridToRows(table.grid, headerRow));
    const where = table.underHeading ? ` under "${table.underHeading}"` : "";
    return {
      label,
      description: `${label}${where}`,
      headerRow,
      rows,
      hasData: rows.rows.length > 0,
    };
  });
  return { plans, headings: structure.headings };
}

/** Checks a `sheet` argument against the labels the file actually has. */
export function assertKnownLabel(plans: TablePlan[], wanted: string | undefined): void {
  if (wanted === undefined || plans.some((plan) => plan.label === wanted)) return;
  const known = plans.map((plan) => `"${plan.label}"`).join(", ");
  throw new ToolError(`No sheet or table "${wanted}". This file has: ${known || "none"}.`);
}

/** Splits one line on the delimiter, honouring double quotes ("a, b" stays one field). */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      field += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}
