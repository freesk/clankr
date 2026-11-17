// Tracing a chart's rows back to their data files and SQL, from the handles its code names.
// The data file decides where the chart is saved (D28); the SQL is saved beside it (DATA-20).
// This reads the code as text and never runs it, so the approval preview can use it too.

import type { ResultHandle, ToolContext } from "../contracts/index.ts";

export interface RowSources {
  /** Real paths of the data files, in the order the code first reaches them. */
  dataFiles: string[];
  /** The SQL statements that produced the rows, in the same order. */
  sql: string[];
}

/** Handles written as string literals, for example data("r12"). */
const quotedHandle = /["'`](r\d+)["'`]/g;
/** run_js code can read other row sets; following a few levels covers real chains. */
const maxDepth = 3;

export function handlesInCode(code: string): ResultHandle[] {
  return [...new Set([...code.matchAll(quotedHandle)].map((match) => match[1] as string))];
}

export async function traceRowSources(
  code: string,
  context: Pick<ToolContext, "results" | "dataSources">,
): Promise<RowSources> {
  const sources: RowSources = { dataFiles: [], sql: [] };
  const visited = new Set<ResultHandle>();
  for (const handle of handlesInCode(code)) await traceHandle(handle, context, sources, visited, 0);
  return sources;
}

async function traceHandle(
  handle: ResultHandle,
  context: Pick<ToolContext, "results" | "dataSources">,
  sources: RowSources,
  visited: Set<ResultHandle>,
  depth: number,
): Promise<void> {
  if (visited.has(handle) || depth > maxDepth) return;
  visited.add(handle);

  const profiled = context.dataSources.find(handle);
  if (profiled) addOnce(sources.dataFiles, profiled.realPath);

  const meta = await context.results.describe(handle).catch(() => undefined);
  if (!meta) return;
  const { sql, path, code } = meta.arguments;
  if (typeof sql === "string") {
    addOnce(sources.sql, sql);
    for (const file of dataFilesInSql(sql, context)) addOnce(sources.dataFiles, file);
  }
  if (typeof path === "string") {
    addOnce(sources.dataFiles, context.dataSources.find(path)?.realPath ?? path);
  }
  if (typeof code === "string") {
    for (const inner of handlesInCode(code))
      await traceHandle(inner, context, sources, visited, depth + 1);
  }
}

/** Table names are matched as plain words; the registry knows which file owns each one. */
function dataFilesInSql(sql: string, context: Pick<ToolContext, "dataSources">): string[] {
  const files: string[] = [];
  for (const word of sql.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    const source = context.dataSources.findByTable(word);
    if (source) addOnce(files, source.realPath);
  }
  return files;
}

function addOnce(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}
