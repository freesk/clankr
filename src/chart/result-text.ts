// What make_chart tells the model: where the file went, how many pages it has, which charts
// carry a summary, and the self-check verdict. Kept short; the tool result is capped.

import {
  type ChartRenderResult,
  type OutputFormat,
  outputFormatLabels,
} from "../contracts/index.ts";
import { formatFileSize, pageCountText } from "../output/file-facts.ts";
import { holdsSeveralCharts } from "../output/formats.ts";
import type { SelfCheckVerdict } from "./self-check.ts";

export interface SavedChartReport {
  rendered: ChartRenderResult;
  format: OutputFormat;
  companions: string[];
  /** Whether each chart, in order, has a summary. */
  hasSummary: boolean[];
  verdict?: SelfCheckVerdict;
  notes: string[];
  logs: string[];
}

export function failedCheckText(verdict: SelfCheckVerdict): string {
  return [
    `Self-check failed: ${verdict.verdict}`,
    "Nothing was saved. Fix the chart and call make_chart once more; that chart will be saved.",
  ].join("\n");
}

export function savedText(report: SavedChartReport): string {
  const { rendered, format, hasSummary, verdict, notes, logs } = report;
  const chartCount = hasSummary.length;
  const what = chartCount === 1 ? "Saved chart" : `Saved ${chartCount} charts`;
  const lines = [`${what}: ${rendered.path} (${fileFacts(rendered, format, chartCount)})`];
  if (format === "xlsx") lines.push(workbookLine);
  lines.push(`Saved beside it: ${report.companions.join(", ")}`);
  // PNG and SVG hold the drawing only, so a summary has nowhere to go.
  if (holdsSeveralCharts(format)) lines.push(summaryLine(hasSummary, format));
  if (verdict) lines.push(`Self-check ${verdict.passed ? "passed" : "failed"}: ${verdict.verdict}`);
  if (notes.length > 0) lines.push(`Notes: ${notes.slice(0, 5).join(" ")}`);
  if (logs.length > 0) lines.push(`Console output:\n${logs.slice(-5).join("\n")}`);
  return lines.join("\n");
}

/** The model has to tell the user what an Excel file holds, since it is not a picture. */
const workbookLine =
  "The workbook holds no picture: a Summary sheet lists each chart's title and summary, and one sheet per chart holds the rows it was drawn from. Tell the user; pdf, docx, or png give the drawing.";

function fileFacts(rendered: ChartRenderResult, format: OutputFormat, chartCount: number): string {
  const facts = [formatFileSize(rendered.sizeBytes), pageCountText(rendered)];
  if (format === "docx" || format === "xlsx") facts.push(outputFormatLabels[format]);
  if (chartCount > 1 && format !== "xlsx") facts.push("portrait, one chart per page");
  return facts.filter((fact) => fact !== undefined).join(", ");
}

/** A missing summary does not fail the call, but the model is told which chart lacks one. */
function summaryLine(hasSummary: boolean[], format: OutputFormat): string {
  const missing = hasSummary.flatMap((has, index) => (has ? [] : [index + 1]));
  if (missing.length === 0) {
    if (format === "xlsx") return "Summaries: on the Summary sheet.";
    return hasSummary.length === 1
      ? "Summary: printed under the chart."
      : "Summaries: printed under each chart.";
  }
  const which = hasSummary.length === 1 ? "the chart" : `chart ${missing.join(", ")}`;
  return `No summary for ${which}. Pass one as render's third argument: 1-3 sentences on what the chart shows.`;
}
