// Writes prepared charts in the chosen format. PDF, PNG, and SVG are drawn by the offline
// browser. A Word document embeds each chart as a PNG the same browser draws; an Excel
// workbook holds the charts' rows and summaries (src/output/chart-files.ts).

import type {
  ChartPagesRequest,
  ChartRenderRequest,
  ChartRenderResult,
  Row,
  Theme,
} from "../contracts/index.ts";
import {
  type ChartForFile,
  writeChartDocument,
  writeChartWorkbook,
} from "../output/chart-files.ts";
import { type ChartOutputPaths, titleText } from "./output-naming.ts";
import type { PreparedChartPage } from "./prepare-spec.ts";

export interface ChartFileRenderer {
  renderChart(request: ChartRenderRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
  /** Several charts in one portrait PDF, a page each. */
  renderChartPages(request: ChartPagesRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
  /** The chart as a PNG at print resolution, for a Word document. */
  renderChartImage(
    spec: Record<string, unknown>,
    rows: Row[],
    theme: Theme,
    signal?: AbortSignal,
  ): Promise<{ png: Buffer; notes: string[] }>;
}

export async function writeChartFile(
  renderer: ChartFileRenderer,
  charts: PreparedChartPage[],
  theme: Theme,
  paths: ChartOutputPaths,
  signal?: AbortSignal,
): Promise<ChartRenderResult> {
  const { format } = paths;
  if (format === "xlsx") return writeChartWorkbook(charts.map(chartForFile), paths.chart);
  if (format === "docx") return writeDocument(renderer, charts, theme, paths.chart, signal);
  if (format === "csv") throw new Error("A chart cannot be saved as CSV.");
  const [only] = charts;
  if (only && charts.length === 1) {
    const request: ChartRenderRequest = {
      spec: only.spec,
      rows: only.rows,
      theme,
      format,
      outputPath: paths.chart,
    };
    if (only.summary) request.summary = only.summary;
    return renderer.renderChart(request, signal);
  }
  return renderer.renderChartPages({ charts, theme, outputPath: paths.chart }, signal);
}

function chartForFile(chart: PreparedChartPage): ChartForFile {
  return { title: titleText(chart.spec), rows: chart.rows, summary: chart.summary };
}

async function writeDocument(
  renderer: ChartFileRenderer,
  charts: PreparedChartPage[],
  theme: Theme,
  outputPath: string,
  signal?: AbortSignal,
): Promise<ChartRenderResult> {
  const pictures = [];
  const notes = new Set<string>();
  for (const [index, chart] of charts.entries()) {
    // The document prints the title as a real heading, so the picture is drawn without it.
    const { title: _title, ...untitledSpec } = chart.spec;
    const image = await renderer.renderChartImage(untitledSpec, chart.rows, theme, signal);
    const label = charts.length > 1 ? `chart ${index + 1}: ` : "";
    for (const note of image.notes) notes.add(label + note);
    pictures.push({ ...chartForFile(chart), png: image.png });
  }
  const written = await writeChartDocument(pictures, theme, outputPath);
  return notes.size > 0 ? { ...written, notes: [...notes] } : written;
}
