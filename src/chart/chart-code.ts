// Running the model's chart code in the isolate (DATA-10, DATA-11). The isolate is injected,
// so this part never imports sandbox's implementation. Inside the isolate,
// `render(spec, rows, summary)` only records its arguments; all checking and drawing happen on
// the host afterwards. Each call adds one chart; several charts go into one file.

import {
  type IsolateHelper,
  type IsolateLimits,
  type JsonValue,
  type ResultStore,
  type Row,
  type RunInIsolate,
  type StandardHelpersFactory,
  ToolError,
} from "../contracts/index.ts";
import { normaliseSummary } from "./chart-summary.ts";
import { namingChart, rowCapMessage } from "./prepare-spec.ts";
import { isPlainObject } from "./spec-tree.ts";

/** One `render` call. */
export interface CapturedChart {
  spec: JsonValue;
  rows: Row[];
  summary?: string;
}

export interface CapturedCharts {
  charts: CapturedChart[];
  /** Short notes for the model, such as a shortened summary. */
  notes: string[];
  logs: string[];
}

/** One page per chart; more would be a report, which this tool does not write. */
export const maxChartsPerCall = 6;

export interface ChartCodeRunner {
  runInIsolate: RunInIsolate;
  createStandardHelpers: StandardHelpersFactory;
}

export async function runChartCode(
  code: string,
  runner: ChartCodeRunner,
  results: ResultStore,
  limits: IsolateLimits,
  signal?: AbortSignal,
): Promise<CapturedCharts> {
  const capture = createRenderCapture(results, limits.rowCap);
  const helpers = { ...runner.createStandardHelpers(results, limits), render: capture.render };
  const outcome = await runner.runInIsolate(code, helpers, limits, signal);
  const logs = outcome.logs;
  if (!outcome.ok) throw new ToolError(withLogs(`The chart code failed: ${outcome.error}`, logs));
  const charts = capture.charts();
  if (charts.length === 0) {
    throw new ToolError(
      withLogs(
        'The code finished without calling render. End it with render(spec, data("rN"), summary).',
        logs,
      ),
    );
  }
  return { charts, notes: capture.notes(), logs };
}

/**
 * The `render` helper. Only ToolError messages reach the model from inside the isolate, so
 * every argument problem is a ToolError, naming the chart once there is more than one. Rows
 * may be the array from data("rN") or the handle.
 */
export function createRenderCapture(results: ResultStore, rowCap: number) {
  const charts: CapturedChart[] = [];
  const notes: string[] = [];

  async function captureOne(
    spec: JsonValue | undefined,
    rows: JsonValue | undefined,
    summary: JsonValue | undefined,
    chartNumber: number,
  ): Promise<CapturedChart> {
    if (!isPlainObject(spec)) {
      throw new ToolError(
        'render(spec, rows, summary): spec must be an object such as { mark: "bar", encoding: {...} }.',
      );
    }
    const tidied = normaliseSummary(summary);
    if (tidied.note) notes.push(`Chart ${chartNumber}: ${tidied.note}`);
    const chart: CapturedChart = {
      spec: spec as JsonValue,
      rows: await rowsFrom(rows, results, rowCap),
    };
    if (tidied.summary) chart.summary = tidied.summary;
    return chart;
  }

  const render: IsolateHelper = async (spec, rows, summary) => {
    const chartNumber = charts.length + 1;
    if (chartNumber > maxChartsPerCall) {
      throw new ToolError(
        `render was called more than ${maxChartsPerCall} times. One make_chart call holds at most ${maxChartsPerCall} charts; put the rest in another make_chart call.`,
      );
    }
    try {
      charts.push(await captureOne(spec, rows, summary, chartNumber));
    } catch (error) {
      // The first chart may be the only one, so it is named only once a second exists.
      throw chartNumber > 1 ? namingChart(error, chartNumber) : error;
    }
    return "ok";
  };

  return { render, charts: () => charts, notes: () => notes };
}

async function rowsFrom(
  rows: JsonValue | undefined,
  results: ResultStore,
  rowCap: number,
): Promise<Row[]> {
  if (typeof rows === "string") return readHandleRows(rows, results, rowCap);
  if (!Array.isArray(rows) || !rows.every(isPlainObject)) {
    throw new ToolError(
      'render(spec, rows): rows must be an array of objects, such as data("r3").',
    );
  }
  return rows as Row[];
}

async function readHandleRows(
  handle: string,
  results: ResultStore,
  rowCap: number,
): Promise<Row[]> {
  const meta = await results.describe(handle).catch(() => undefined);
  if (meta?.kind !== "rows") {
    throw new ToolError(
      `render(spec, rows): "${handle}" is not a stored row set. Pass data("rN").`,
    );
  }
  if (meta.itemCount > rowCap) throw new ToolError(rowCapMessage(meta.itemCount, rowCap));
  const rows: Row[] = [];
  for await (const row of results.readRows(handle, rowCap)) rows.push(row);
  return rows;
}

function withLogs(message: string, logs: string[]): string {
  if (logs.length === 0) return message;
  return `${message}\nConsole output:\n${logs.slice(-10).join("\n")}`;
}
