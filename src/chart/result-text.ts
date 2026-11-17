// What make_chart tells the model: where the file went, how many pages it has, which charts
// carry a summary, and the self-check verdict. Kept short; the tool result is capped.

import type { ChartFormat, ChartRenderResult } from "../contracts/index.ts";
import type { SelfCheckVerdict } from "./self-check.ts";

export interface SavedChartReport {
  rendered: ChartRenderResult;
  format: ChartFormat;
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
  const { rendered, hasSummary, verdict, notes, logs } = report;
  const chartCount = hasSummary.length;
  const what = chartCount === 1 ? "Saved chart" : `Saved ${chartCount} charts`;
  const lines = [`${what}: ${rendered.path} (${fileFacts(rendered, chartCount)})`];
  lines.push(`Saved beside it: ${report.companions.join(", ")}`);
  // PNG and SVG hold the drawing only, so a summary has nowhere to go.
  if (report.format === "pdf") lines.push(summaryLine(hasSummary));
  if (verdict) lines.push(`Self-check ${verdict.passed ? "passed" : "failed"}: ${verdict.verdict}`);
  if (notes.length > 0) lines.push(`Notes: ${notes.slice(0, 5).join(" ")}`);
  if (logs.length > 0) lines.push(`Console output:\n${logs.slice(-5).join("\n")}`);
  return lines.join("\n");
}

function fileFacts(rendered: ChartRenderResult, chartCount: number): string {
  const facts = [formatSize(rendered.sizeBytes)];
  if (rendered.pageCount !== undefined) {
    facts.push(`${rendered.pageCount} ${rendered.pageCount === 1 ? "page" : "pages"}`);
  }
  if (chartCount > 1) facts.push("portrait, one chart per page");
  return facts.join(", ");
}

/** A missing summary does not fail the call, but the model is told which chart lacks one. */
function summaryLine(hasSummary: boolean[]): string {
  const missing = hasSummary.flatMap((has, index) => (has ? [] : [index + 1]));
  if (missing.length === 0) {
    return hasSummary.length === 1
      ? "Summary: printed under the chart."
      : "Summaries: printed under each chart.";
  }
  const which = hasSummary.length === 1 ? "the chart" : `chart ${missing.join(", ")}`;
  return `No summary for ${which}. Pass one as render's third argument: 1-3 sentences on what the chart shows.`;
}

function formatSize(sizeBytes: number): string {
  return sizeBytes < 1024 ? `${sizeBytes} B` : `${Math.round(sizeBytes / 1024)} KB`;
}
