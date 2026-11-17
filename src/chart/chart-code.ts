// Running the model's chart code in the isolate (DATA-10, DATA-11). The isolate is injected,
// so this part never imports sandbox's implementation. Inside the isolate, `render(spec, rows)`
// only records its arguments; all checking and drawing happen on the host afterwards.

import type { Config } from "../config/schema.ts";
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
import { rowCapMessage } from "./prepare-spec.ts";
import { isPlainObject } from "./spec-tree.ts";

export interface CapturedChart {
  spec: JsonValue;
  rows: Row[];
  logs: string[];
}

export interface ChartCodeRunner {
  runInIsolate: RunInIsolate;
  createStandardHelpers: StandardHelpersFactory;
}

/** Built from config the same way as run_js's limits, so both tools share one set of numbers. */
export function chartIsolateLimits(config: Config): IsolateLimits {
  return {
    timeoutMs: config.data.isolateTimeoutMs,
    memoryLimitMb: config.data.isolateMemoryLimitMb,
    rowCap: config.data.rowCap,
  };
}

export async function runChartCode(
  code: string,
  runner: ChartCodeRunner,
  results: ResultStore,
  limits: IsolateLimits,
  signal?: AbortSignal,
): Promise<CapturedChart> {
  const capture = createRenderCapture(results, limits.rowCap);
  const helpers = { ...runner.createStandardHelpers(results, limits), render: capture.render };
  const outcome = await runner.runInIsolate(code, helpers, limits, signal);
  const logs = outcome.logs;
  if (!outcome.ok) throw new ToolError(withLogs(`The chart code failed: ${outcome.error}`, logs));
  const captured = capture.captured();
  if (!captured) {
    throw new ToolError(
      withLogs(
        'The code finished without calling render. End it with render(spec, data("rN")).',
        logs,
      ),
    );
  }
  return { ...captured, logs };
}

/**
 * The `render` helper. Only ToolError messages reach the model from inside the isolate, so
 * every argument problem is a ToolError. Rows may be the array from data("rN") or the handle.
 */
export function createRenderCapture(results: ResultStore, rowCap: number) {
  let captured: { spec: JsonValue; rows: Row[] } | undefined;

  const render: IsolateHelper = async (spec, rows) => {
    if (captured)
      throw new ToolError("render was already called. Call it once, with the final spec.");
    if (!isPlainObject(spec)) {
      throw new ToolError(
        'render(spec, rows): spec must be an object such as { mark: "bar", encoding: {...} }.',
      );
    }
    captured = { spec: spec as JsonValue, rows: await rowsFrom(rows, results, rowCap) };
    return "ok";
  };

  return { render, captured: () => captured };
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
