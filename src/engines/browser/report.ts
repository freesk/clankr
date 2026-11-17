// Several charts in one PDF (DATA-19). Two layouts: a report of charts and text blocks that
// flow down the page, and chart pages, one chart per printed page with its summary under it.
// The page stylesheet keeps a chart from splitting across pages and starts each chart page
// on a new sheet.

import type { Page } from "playwright-core";
import type { ChartPage, Row } from "../../contracts/index.ts";
import {
  addTextBlock,
  ChartDrawError,
  drawChart,
  fitLastChart,
  startPrintedPage,
  type TextBlockKind,
} from "./page-calls.ts";
import { areaAboveSummary, fitSpecToArea } from "./page-layout.ts";

export type ReportBlock =
  | { kind: "chart"; spec: Record<string, unknown>; rows: Row[] }
  | { kind: TextBlockKind; text: string };

type Area = { width: number; height: number };
type PrepareSpec = (spec: Record<string, unknown>) => Record<string, unknown>;

/** Report charts without a size of their own take the page width and about half its height. */
const reportChartHeightShare = 0.45;

/** Draws every block in order and returns the charts' warnings. */
export async function composeReport(
  page: Page,
  blocks: ReportBlock[],
  area: Area,
  prepareSpec: PrepareSpec,
): Promise<string[]> {
  const chartArea = { width: area.width, height: Math.floor(area.height * reportChartHeightShare) };
  const warnings: string[] = [];
  for (const block of blocks) {
    if (block.kind === "chart") {
      const spec = fitSpecToArea(prepareSpec(block.spec), chartArea, block.rows);
      const drawn = await drawChart(page, spec, block.rows);
      warnings.push(...drawn.warnings);
    } else {
      await addTextBlock(page, block.kind, block.text);
    }
  }
  return warnings;
}

/**
 * One chart per printed page: the chart fills the printable area less the room its summary
 * needs, then the summary goes under it. With several charts, messages name the chart.
 */
export async function composeChartPages(
  page: Page,
  charts: ChartPage[],
  area: Area,
  prepareSpec: PrepareSpec,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const [index, chart] of charts.entries()) {
    const label = charts.length > 1 ? `chart ${index + 1}: ` : "";
    await startPrintedPage(page);
    const chartArea = areaAboveSummary(area, chart.summary);
    const spec = fitSpecToArea(prepareSpec(chart.spec), chartArea, chart.rows);
    const drawn = await drawChart(page, spec, chart.rows).catch((error: unknown) => {
      throw error instanceof ChartDrawError ? new ChartDrawError(label + error.message) : error;
    });
    warnings.push(...drawn.warnings.map((warning) => label + warning));
    await fitLastChart(page, chartArea);
    if (chart.summary) await addTextBlock(page, "summary", chart.summary);
  }
  return warnings;
}
