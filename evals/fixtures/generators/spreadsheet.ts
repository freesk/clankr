// Spreadsheet fixtures (S7, S8): .xlsx through SheetJS, and .csv streamed to
// disk so the 1,000,000-row file never sits in memory.

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

export async function writeCsv(path: string, options: TableOptions): Promise<void> {
  const dataset = datasets[options.dataset];
  const output = createWriteStream(path, { encoding: "utf8" });
  const finished = once(output, "finish");
  await writeLine(output, dataset.columns.join(","));
  for (const row of dataset.rows(options.rows ?? dataset.defaultRowCount)) {
    await writeLine(output, csvLine(row, dataset.columns));
  }
  output.end();
  await finished;
}

async function writeLine(output: NodeJS.WritableStream, line: string): Promise<void> {
  // Respect backpressure, or a million rows pile up in the stream's buffer.
  if (!output.write(`${line}\n`)) await once(output, "drain");
}

function csvLine(row: DataRow, columns: string[]): string {
  return columns.map((column) => csvCell(row[column] ?? "")).join(",");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
