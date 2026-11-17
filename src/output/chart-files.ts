// Charts as office files. A Word document holds each chart as a picture with its title above
// and its summary as real text below. An Excel workbook holds no picture (SheetJS cannot embed
// one): a Summary sheet lists the charts, and each chart gets a sheet with the rows it was
// drawn from, so the reader can rebuild or extend the chart in Excel.

import type { ChartRenderResult, Row, Theme } from "../contracts/index.ts";
import { buildDocx, type DocxBlock } from "./docx-writer.ts";
import { writeNewFile } from "./new-file.ts";
import { describeTable } from "./table-data.ts";
import { buildWorkbook, uniqueSheetNames } from "./xlsx-writer.ts";

export interface ChartForFile {
  /** The chart's own title; empty when the spec has none. */
  title: string;
  rows: Row[];
  summary?: string | undefined;
}

export interface ChartPicture extends ChartForFile {
  /** The chart drawn by the offline renderer at print resolution. */
  png: Buffer;
}

const summarySheetName = "Summary";

function titleOf(chart: ChartForFile, index: number): string {
  return chart.title.trim() || `Chart ${index + 1}`;
}

/**
 * One chart uses the theme's page. Several charts print portrait, a page each, as in the PDF
 * (specs/pdf.md), so the two formats lay a set of charts out the same way.
 */
export function writeChartDocument(
  charts: ChartPicture[],
  theme: Theme,
  outputPath: string,
): Promise<ChartRenderResult> {
  const blocks = charts.flatMap((chart, index): DocxBlock[] => {
    const title = titleOf(chart, index);
    const page: DocxBlock[] = [
      { kind: "heading", text: title, startsPage: index > 0 },
      { kind: "image", png: chart.png, description: chart.summary ?? title },
    ];
    if (chart.summary) page.push({ kind: "paragraph", text: chart.summary });
    return page;
  });
  const page: Theme["page"] =
    charts.length > 1 ? { ...theme.page, orientation: "portrait" } : theme.page;
  const bytes = buildDocx({ blocks, page, fontFamily: theme.fontFamily, footer: theme.footer });
  return writeNewFile(outputPath, bytes);
}

export async function writeChartWorkbook(
  charts: ChartForFile[],
  outputPath: string,
): Promise<ChartRenderResult> {
  const titles = charts.map(titleOf);
  const [, ...dataSheetNames] = uniqueSheetNames([summarySheetName, ...titles]);
  const summaryRows: Row[] = charts.map((chart, index) => ({
    Chart: index + 1,
    Title: titles[index] ?? "",
    Summary: chart.summary ?? "",
    "Data sheet": dataSheetNames[index] ?? "",
    Rows: chart.rows.length,
  }));
  const bytes = await buildWorkbook([
    { name: summarySheetName, table: describeTable(summaryRows) },
    ...charts.map((chart, index) => ({
      name: dataSheetNames[index] ?? "",
      table: describeTable(chart.rows),
    })),
  ]);
  return writeNewFile(outputPath, bytes);
}
