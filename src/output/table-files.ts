// A stored row set as an office file: one typed sheet in an Excel workbook, a title and a
// table in a Word document, or a CSV file. The PDF table is drawn by the offline browser
// (src/engines/browser/), which the export_table tool calls itself.

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { ChartRenderResult, Row, Theme } from "../contracts/index.ts";
import { buildDocx } from "./docx-writer.ts";
import { writeNewFile } from "./new-file.ts";
import { cellText, type TableData, textGrid } from "./table-data.ts";
import { buildWorkbook } from "./xlsx-writer.ts";

export interface TableForFile {
  title: string;
  table: TableData;
}

export async function writeTableWorkbook(
  content: TableForFile,
  outputPath: string,
): Promise<ChartRenderResult> {
  const bytes = await buildWorkbook([{ name: content.title, table: content.table }]);
  return writeNewFile(outputPath, bytes);
}

export function writeTableDocument(
  content: TableForFile,
  theme: Theme,
  outputPath: string,
): Promise<ChartRenderResult> {
  const { table } = content;
  const bytes = buildDocx({
    blocks: [
      { kind: "heading", text: content.title },
      {
        kind: "table",
        columns: table.columns.map((column) => column.name),
        cells: textGrid(table),
        numericColumns: numericColumnsOf(table),
      },
    ],
    page: theme.page,
    fontFamily: theme.fontFamily,
    footer: theme.footer,
  });
  return writeNewFile(outputPath, bytes);
}

/** Numbers are right-aligned in a Word or PDF table. */
export function numericColumnsOf(table: TableData): boolean[] {
  return table.columns.map((column) => column.kind === "number");
}

/** Excel reads a CSV file as UTF-8 only when it starts with this mark. */
const utf8ByteOrderMark = String.fromCharCode(0xfeff);

/**
 * Rows are written as they are read, so a row set of any size uses flat memory. Returns the
 * number of rows written. Never overwrites (D28).
 */
export async function writeTableCsv(
  columns: string[],
  rows: AsyncIterable<Row>,
  outputPath: string,
): Promise<ChartRenderResult & { rowCount: number }> {
  await mkdir(dirname(outputPath), { recursive: true });
  let rowCount = 0;
  async function* lines() {
    yield utf8ByteOrderMark + csvLine(columns);
    for await (const row of rows) {
      rowCount++;
      yield csvLine(columns.map((name) => cellText(row[name])));
    }
  }
  await pipeline(lines(), createWriteStream(outputPath, { flags: "wx" }));
  return { path: outputPath, sizeBytes: (await stat(outputPath)).size, rowCount };
}

function csvLine(fields: string[]): string {
  return `${fields.map(csvField).join(",")}\r\n`;
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
