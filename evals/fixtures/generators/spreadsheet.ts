// Spreadsheet fixtures (S7, S8): .xlsx and .xls through SheetJS, and delimited
// text. The 1,000,000-row CSV is streamed to disk so it never sits in memory.

import { once } from "node:events";
import { createWriteStream } from "node:fs";
import * as XLSX from "xlsx";
import { z } from "zod";
import { type DataRow, datasetNames, datasets } from "../datasets.ts";

/** Above this, write CSV: building an .xlsx holds the whole sheet in memory. */
const maximumXlsxRows = 100_000;

export const tableOptions = z.object({
  dataset: z.enum(datasetNames as [keyof typeof datasets]),
  rows: z.number().int().positive().optional(),
  sheetName: z.string().default("Sheet1"),
});
export type TableOptions = z.infer<typeof tableOptions>;

export function renderXlsx(options: TableOptions): Buffer {
  const dataset = datasets[options.dataset];
  const rowCount = options.rows ?? dataset.defaultRowCount;
  if (rowCount > maximumXlsxRows) {
    throw new Error(`xlsx fixtures are limited to ${maximumXlsxRows} rows; use csv`);
  }
  const rows = [...dataset.rows(rowCount)];
  const sheet = XLSX.utils.json_to_sheet(rows, { header: dataset.columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** A number shown through an Excel number format, such as a date serial or a currency. */
export interface FormattedNumberCell {
  t: "n";
  v: number;
  z: string;
}

export type SheetCell = string | number | boolean | null | FormattedNumberCell;

export interface WorkbookSheet {
  name: string;
  /** Row by row, title blocks and header included. `null` leaves a cell empty. */
  rows: SheetCell[][];
}

const millisecondsPerDay = 86_400_000;
const excelEpoch = Date.UTC(1899, 11, 30);

/**
 * A date as an Excel serial with a date format. Writing serials instead of `Date`s keeps
 * the file the same in every time zone (SheetJS converts `Date`s as local time).
 * "m/d/yy" is Excel's built-in short date (format 14): DuckDB's Excel reader treats only
 * built-in date formats as dates, and reads a custom "yyyy-mm-dd" cell as a number.
 */
export function dateCell(isoDate: string): FormattedNumberCell {
  const [year, month, day] = isoDate.split("-").map(Number);
  const serial =
    (Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - excelEpoch) / millisecondsPerDay;
  return { t: "n", v: serial, z: "m/d/yy" };
}

export function currencyCell(amount: number): FormattedNumberCell {
  return { t: "n", v: amount, z: '"$"#,##0.00' };
}

/**
 * A multi-sheet workbook. SheetJS writes no timestamps, so the same sheets give the same
 * bytes on every run. "xls" is the legacy BIFF8 format.
 */
export function renderWorkbook(sheets: WorkbookSheet[], format: "xlsx" | "xls"): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  const bookType = format === "xls" ? "biff8" : "xlsx";
  return XLSX.write(workbook, { type: "buffer", bookType, compression: true }) as Buffer;
}

export interface DelimitedTable {
  /** Lines written above the header, such as a report title. */
  preamble?: string[];
  columns: string[];
  rows: DataRow[];
  delimiter: "," | "\t";
}

/** A small CSV or TSV built in memory; use `writeCsv` for large files. */
export function delimitedText(table: DelimitedTable): string {
  const lines = [
    ...(table.preamble ?? []),
    table.columns.join(table.delimiter),
    ...table.rows.map((row) => delimitedLine(row, table.columns, table.delimiter)),
  ];
  return `${lines.join("\n")}\n`;
}

export async function writeCsv(path: string, options: TableOptions): Promise<void> {
  const dataset = datasets[options.dataset];
  const output = createWriteStream(path, { encoding: "utf8" });
  const finished = once(output, "finish");
  await writeLine(output, dataset.columns.join(","));
  for (const row of dataset.rows(options.rows ?? dataset.defaultRowCount)) {
    await writeLine(output, delimitedLine(row, dataset.columns, ","));
  }
  output.end();
  await finished;
}

async function writeLine(output: NodeJS.WritableStream, line: string): Promise<void> {
  // Respect backpressure, or a million rows pile up in the stream's buffer.
  if (!output.write(`${line}\n`)) await once(output, "drain");
}

function delimitedLine(row: DataRow, columns: string[], delimiter: string): string {
  return columns.map((column) => delimitedCell(row[column] ?? "", delimiter)).join(delimiter);
}

function delimitedCell(value: string | number, delimiter: string): string {
  const text = String(value);
  const needsQuotes = text.includes(delimiter) || /["\n]/.test(text);
  return needsQuotes ? `"${text.replaceAll('"', '""')}"` : text;
}
