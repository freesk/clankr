// `run_js`: reshape data with model-written JavaScript in the V8 isolate (DATA-8, DATA-9).
// See specs/sandbox.md.

import { z } from "zod";
import { defaultConfig } from "../../config/index.ts";
import type {
  ChangePreview,
  Config,
  DataSourceRegistry,
  IsolateHelper,
  IsolateLimits,
  IsolateResult,
  JsonValue,
  ResultStore,
  ToolContext,
  ToolDefinition,
} from "../../contracts/index.ts";
import { ToolError } from "../../contracts/index.ts";
import { createStandardHelpers, isRowArray, runInIsolate } from "../../engines/isolate/index.ts";

const runJsParameters = z.object({
  code: z
    .string()
    .min(1)
    .describe(
      'JavaScript to run. End with an expression or use return. Example: data("r12").filter((row) => row.total > 0)',
    ),
});

type RunJsArguments = z.infer<typeof runJsParameters>;

/** Rows shown in the result; the full row set stays behind its handle. */
const previewRowCount = 20;
/** Console lines kept in an error message, which must stay short. */
const errorLogLineCount = 10;
const maxErrorLogLineLength = 200;

export const runJsTool: ToolDefinition<typeof runJsParameters> = {
  name: "run_js",
  description:
    "Run JavaScript in a sandbox with no file, network, or module access, to reshape stored rows. " +
    "data(handle) returns a row set, save(name, rows) stores rows and returns a handle, and console.log output is shown.",
  parameters: runJsParameters,
  permission: "execute",
  resultTokenCap: defaultConfig().context.defaultResultTokenCap,
  groups: ["data"],
  keyArgument: "code",

  async previewChange(args, context): Promise<ChangePreview> {
    const handles = handlesReadBy(args.code);
    const dataSourcePaths = await dataSourcePathsFor(handles, context);
    const reads = handles.length > 0 ? ` reading ${handles.join(", ")}` : "";
    return {
      summary: `Run JavaScript in the sandbox${reads}`,
      code: args.code,
      targetPaths: [],
      ...(dataSourcePaths.length > 0 ? { dataSourcePaths } : {}),
    };
  },

  async run(args, context) {
    const limits = isolateLimitsFrom(context.config);
    const savedHandles: string[] = [];
    const helpers = recordSaves(createStandardHelpers(context.results, limits), savedHandles);
    const result = await runInIsolate(args.code, helpers, limits, context.signal);
    if (!result.ok) throw new ToolError(failureText(result));

    const body = await describeValue(result.value, args, context.results, limits);
    const sections = [body.text, savedText(savedHandles), logsText(result.logs)];
    return {
      text: sections.filter((section) => section.length > 0).join("\n\n"),
      handles: [...savedHandles, ...body.handles],
    };
  },
};

export function isolateLimitsFrom(config: Config): IsolateLimits {
  return {
    timeoutMs: config.data.isolateTimeoutMs,
    memoryLimitMb: config.data.isolateMemoryLimitMb,
    rowCap: config.data.rowCap,
  };
}

// Wraps `save` so the tool can tell the model which handles the code created.
function recordSaves(
  helpers: Record<string, IsolateHelper>,
  savedHandles: string[],
): Record<string, IsolateHelper> {
  const save = helpers.save;
  if (!save) return helpers;
  return {
    ...helpers,
    save: async (...args) => {
      const handle = await save(...args);
      if (typeof handle === "string") savedHandles.push(handle);
      return handle;
    },
  };
}

interface DescribedValue {
  text: string;
  handles: string[];
}

async function describeValue(
  value: JsonValue | undefined,
  args: RunJsArguments,
  results: ResultStore,
  limits: IsolateLimits,
): Promise<DescribedValue> {
  if (value === undefined) {
    return {
      text: "The code returned no value. End with an expression or use return.",
      handles: [],
    };
  }
  if (isRowArray(value) && value.length > 0) return await storeRows(value, args, results, limits);
  return { text: typeof value === "string" ? value : JSON.stringify(value), handles: [] };
}

// A returned row set is stored like a query_sql result, so the model sees its shape and first
// rows and can pass the handle on to make_chart or read_result.
async function storeRows(
  rows: Record<string, JsonValue>[],
  args: RunJsArguments,
  results: ResultStore,
  limits: IsolateLimits,
): Promise<DescribedValue> {
  if (rows.length > limits.rowCap) {
    throw new ToolError(
      `The code returned ${rows.length} rows; at most ${limits.rowCap} can be stored. Aggregate first.`,
    );
  }
  const handle = await results.putRows(rows, {
    tool: "run_js",
    arguments: { code: args.code },
  });
  const meta = await results.describe(handle);
  const shown = rows.slice(0, previewRowCount);
  const lines = [
    `Returned ${rows.length} rows as ${handle}. Columns: ${(meta.columns ?? []).join(", ")}.`,
    shown.length < rows.length ? `First ${shown.length} rows:` : "Rows:",
    ...shown.map((row) => JSON.stringify(row)),
  ];
  return { text: lines.join("\n"), handles: [handle] };
}

function savedText(savedHandles: string[]): string {
  return savedHandles.length > 0 ? `Saved: ${savedHandles.join(", ")}` : "";
}

function logsText(logs: string[]): string {
  return logs.length > 0 ? `Console:\n${logs.join("\n")}` : "";
}

function failureText(result: Extract<IsolateResult, { ok: false }>): string {
  const lastLogs = result.logs
    .slice(-errorLogLineCount)
    .map((line) =>
      line.length > maxErrorLogLineLength ? `${line.slice(0, maxErrorLogLineLength)}…` : line,
    );
  if (lastLogs.length === 0) return result.error;
  return `${result.error}\nConsole before the error:\n${lastLogs.join("\n")}`;
}

/** Handles the code passes to `data(...)` as a string literal; others cannot be known before it runs. */
export function handlesReadBy(code: string): string[] {
  const pattern = /\bdata\(\s*(["'`])([^"'`\n]+)\1\s*\)/g;
  const handles = new Set<string>();
  for (const match of code.matchAll(pattern)) {
    if (match[2]) handles.add(match[2]);
  }
  return [...handles];
}

/**
 * The data files behind the handles, for execute-class grants (D19). A handle is traced through
 * the data source registry, then through its provenance: a query_sql result names its tables, and
 * an earlier run_js result names the handles its own code read.
 */
async function dataSourcePathsFor(handles: string[], context: ToolContext): Promise<string[]> {
  const paths = new Set<string>();
  const visited = new Set<string>();
  const pending = [...handles];
  while (pending.length > 0) {
    const handle = pending.pop() as string;
    if (visited.has(handle)) continue;
    visited.add(handle);
    const traced = await traceHandle(handle, context);
    for (const path of traced.paths) paths.add(path);
    pending.push(...traced.handles);
  }
  return [...paths];
}

async function traceHandle(
  handle: string,
  context: ToolContext,
): Promise<{ paths: string[]; handles: string[] }> {
  const source = findSourceByHandle(handle, context.dataSources);
  if (source) return { paths: [source], handles: [] };
  const meta = await context.results.describe(handle).catch(() => undefined);
  if (!meta) return { paths: [], handles: [] };
  const texts = Object.values(meta.arguments).filter(
    (value): value is string => typeof value === "string",
  );
  const handles = meta.tool === "run_js" ? texts.flatMap(handlesReadBy) : [];
  return { paths: sourcesNamedIn(texts, context.dataSources), handles };
}

function findSourceByHandle(handle: string, registry: DataSourceRegistry): string | undefined {
  const source =
    registry.find(handle) ??
    registry
      .list()
      .find((candidate) => candidate.tables.some((table) => table.rowsHandle === handle));
  return source?.realPath;
}

// A source is named when an argument is its path, or mentions one of its SQL table names as a
// whole word. SQL identifiers are case-insensitive, so the comparison is too.
function sourcesNamedIn(texts: string[], registry: DataSourceRegistry): string[] {
  const words = new Set(texts.flatMap((text) => text.toLowerCase().split(/[^a-z0-9_]+/)));
  return registry
    .list()
    .filter(
      (source) =>
        texts.includes(source.realPath) ||
        source.tables.some((table) => words.has(table.sqlName.toLowerCase())),
    )
    .map((source) => source.realPath);
}
