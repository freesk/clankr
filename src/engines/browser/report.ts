// Multi-chart reports (DATA-19): charts and text blocks drawn one after another into a single
// page, which prints as one PDF. The page stylesheet keeps a chart from splitting across pages
// and a heading from being left alone at the bottom of one.

import type { Page } from "playwright-core";
import type { Row } from "../../contracts/index.ts";
import { addTextBlock, drawChart, type TextBlockKind } from "./page-calls.ts";
import { fitSpecToArea } from "./page-layout.ts";

export type ReportBlock =
  | { kind: "chart"; spec: Record<string, unknown>; rows: Row[] }
  | { kind: TextBlockKind; text: string };

/** Report charts without a size of their own take the page width and about half its height. */
const reportChartHeightShare = 0.45;

/** Draws every block in order and returns the charts' warnings. */
export async function composeReport(
  page: Page,
  blocks: ReportBlock[],
  area: { width: number; height: number },
  prepareSpec: (spec: Record<string, unknown>) => Record<string, unknown>,
): Promise<string[]> {
  const chartArea = { width: area.width, height: Math.floor(area.height * reportChartHeightShare) };
  const warnings: string[] = [];
  for (const block of blocks) {
    if (block.kind === "chart") {
      const spec = fitSpecToArea(prepareSpec(block.spec), chartArea);
      const drawn = await drawChart(page, spec, block.rows);
      warnings.push(...drawn.warnings);
    } else {
      await addTextBlock(page, block.kind, block.text);
    }
  }
  return warnings;
}
