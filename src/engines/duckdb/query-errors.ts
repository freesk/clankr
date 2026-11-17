// Turning DuckDB failures into short messages the model can act on (specs/sql.md,
// "Errors are short and fixable"). DuckDB's own text carries absolute paths
// (including the home folder) and tuning advice meant for people, so it is rewritten.

import { basename } from "node:path";
import { ToolError } from "../../contracts/index.ts";
import { QueryInterruptedError } from "./run-query.ts";

export interface ErrorContext {
  timeoutMs: number;
  memoryLimitMb: number;
  /** Every table the query could have used. */
  tableNames: string[];
  /** Columns of the tables the query names, for an unknown-column error. */
  columnsOfNamedTables(): Promise<string[]>;
}

const maximumDetailLength = 300;

export async function shapeQueryError(error: unknown, context: ErrorContext): Promise<ToolError> {
  if (error instanceof ToolError) return error;
  if (error instanceof QueryInterruptedError) return interruptedError(error, context);
  const message = error instanceof Error ? error.message : String(error);
  // DuckDB sometimes wraps the real error, as in "Failed to extract statements: Parser Error: ...".
  const firstLine = stripPaths(message.split("\n")[0] ?? "").replace(
    /^[^:]*: (?=\w[\w ]* Error:)/,
    "",
  );
  const kind = /^([A-Za-z ]+) Error:/.exec(firstLine)?.[1] ?? "";

  if (kind === "Out of Memory") {
    return new ToolError(
      `The query needed more than ${context.memoryLimitMb} MB of memory. Filter or aggregate earlier, or select fewer columns.`,
    );
  }
  if (kind === "Permission" || /file system operations are disabled/.test(message)) {
    return new ToolError(
      `SQL can only read inspected files, by table name, not by path or URL. Tables: ${listOrNone(context.tableNames)}.`,
    );
  }
  const missingTable = /Table with name "?([^"\s!]+)"? does not exist/.exec(firstLine)?.[1];
  if (missingTable) {
    return new ToolError(
      `Table "${missingTable}" does not exist. Tables: ${listOrNone(context.tableNames)}. Inspect a file with inspect_data to add its tables.`,
    );
  }
  const missingColumn = /Referenced column "?([^"]+?)"? not found/.exec(firstLine)?.[1];
  if (missingColumn) {
    const columns = await context.columnsOfNamedTables();
    return new ToolError(
      `Column "${missingColumn}" does not exist. Columns: ${listOrNone(columns)}. Quote names that contain spaces with double quotes.`,
    );
  }
  return new ToolError(truncate(firstLine.replace(/^([A-Za-z ]+) Error:\s*/, "$1 error: ")));
}

function interruptedError(error: QueryInterruptedError, context: ErrorContext): ToolError {
  if (error.reason === "cancelled") return new ToolError("The query was cancelled.");
  const seconds = Math.round(context.timeoutMs / 100) / 10;
  return new ToolError(
    `The query ran longer than ${seconds} s and was stopped. Filter rows or aggregate in SQL, and avoid joins that multiply rows.`,
  );
}

/** Replaces every absolute path with its file name. */
export function stripPaths(text: string): string {
  return text.replace(absolutePathPattern, (path) => basename(path));
}

/** A run of non-space characters starting with `/` or `~/`, at the start of a word or quote. */
const absolutePathPattern = /(?<=^|[\s"'(=])~?\/[^\s"')]+/g;

function listOrNone(names: string[]): string {
  return names.length === 0 ? "(none)" : names.join(", ");
}

function truncate(text: string): string {
  return text.length <= maximumDetailLength ? text : `${text.slice(0, maximumDetailLength)}…`;
}
