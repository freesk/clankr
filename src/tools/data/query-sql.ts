// `query_sql` (DATA-6, DATA-9): run one read-only SELECT over inspected files in the
// session's locked DuckDB engine. The full result is stored as a row set with its SQL as
// provenance; the model sees the columns, the row count, the first rows, and the handle.

import { basename } from "node:path";
import { z } from "zod";
import type {
  ChangePreview,
  JsonValue,
  Row,
  ToolContext,
  ToolDefinition,
  ToolOutput,
} from "../../contracts/index.ts";
import { ToolError } from "../../contracts/index.ts";
import {
  assertSingleSelect,
  type SessionEngine,
  sessionEngineFor,
  shapeQueryError,
  streamRows,
  withQueryLimits,
} from "../../engines/duckdb/index.ts";

const parameters = z.object({
  sql: z.string().min(1).describe("One SELECT; quote table names with spaces"),
});

type QuerySqlArguments = z.infer<typeof parameters>;

export const querySqlTool: ToolDefinition<typeof parameters> = {
  name: "query_sql",
  description:
    "Run one read-only DuckDB SELECT over tables from inspect_data. Returns the first rows and a handle to all of them.",
  parameters,
  permission: "execute",
  resultTokenCap: 1_000,
  groups: ["data"],
  keyArgument: "sql",
  async previewChange(args, context) {
    return buildPreview(args, sessionEngineFor(context));
  },
  async run(args, context) {
    return runQuery(args, context);
  },
};

function buildPreview(args: QuerySqlArguments, engine: SessionEngine): ChangePreview {
  const dataSourcePaths = [
    ...new Set(engine.tablesNamedIn(args.sql).map((table) => table.source.realPath)),
  ];
  const fileNames = dataSourcePaths.map((path) => basename(path)).join(", ");
  return {
    summary: fileNames ? `Run SQL over ${fileNames}` : "Run SQL",
    code: args.sql,
    targetPaths: [],
    dataSourcePaths,
  };
}

interface QueryResult {
  columns: string[];
  previewRows: Row[];
  storedRowCount: number;
  hasMoreRows: boolean;
  handle: string;
}

async function runQuery(args: QuerySqlArguments, context: ToolContext): Promise<ToolOutput> {
  const engine = sessionEngineFor(context);
  if (engine.tables().length === 0) {
    throw new ToolError("No data file is inspected yet. Run inspect_data on the file first.");
  }
  const limits = context.config.data;
  try {
    const connection = await engine.connection();
    const result = await withQueryLimits(
      connection,
      { timeoutMs: limits.sqlTimeoutMs, signal: context.signal },
      async () => {
        await assertSingleSelect(connection, args.sql);
        return storeResult(args, engine, context);
      },
    );
    return { text: formatResult(result, limits.sqlStoredRowLimit), handles: [result.handle] };
  } catch (error) {
    throw await shapeQueryError(error, {
      timeoutMs: limits.sqlTimeoutMs,
      memoryLimitMb: limits.sqlMemoryLimitMb,
      tableNames: engine.tables().map((table) => table.sqlName),
      columnsOfNamedTables: () =>
        engine.columnsOf(engine.tablesNamedIn(args.sql).map((table) => table.sqlName)),
    });
  }
}

async function storeResult(
  args: QuerySqlArguments,
  engine: SessionEngine,
  context: ToolContext,
): Promise<QueryResult> {
  const { sqlStoredRowLimit, sqlPreviewRows } = context.config.data;
  const stream = await streamRows(await engine.connection(), args.sql);
  const previewRows: Row[] = [];
  let storedRowCount = 0;
  let hasMoreRows = false;

  async function* limitedRows(): AsyncGenerator<Row> {
    for await (const row of stream.rows) {
      if (storedRowCount === sqlStoredRowLimit) {
        hasMoreRows = true;
        return;
      }
      storedRowCount++;
      if (previewRows.length < sqlPreviewRows) previewRows.push(row);
      yield row;
    }
  }

  const handle = await context.results.putRows(limitedRows(), {
    tool: "query_sql",
    arguments: { sql: args.sql },
    label: `query_sql ${args.sql.replace(/\s+/g, " ").slice(0, 80)}`,
    dataSourcePaths: buildPreview(args, engine).dataSourcePaths ?? [],
  });
  return { columns: stream.columns, previewRows, storedRowCount, hasMoreRows, handle };
}

function formatResult(result: QueryResult, storedRowLimit: number): string {
  const { columns, previewRows, storedRowCount, handle } = result;
  const lines = [
    `${countLabel(storedRowCount, "row")}, ${countLabel(columns.length, "column")}. Full result: ${handle}.`,
  ];
  if (result.hasMoreRows) {
    lines.push(
      `Only the first ${storedRowLimit.toLocaleString("en-US")} rows were stored. Aggregate or filter to get the whole answer.`,
    );
  }
  if (columns.length > 0) {
    lines.push(columns.join(" | "));
    for (const row of previewRows) {
      lines.push(columns.map((column) => formatCell(row[column] ?? null)).join(" | "));
    }
  }
  if (previewRows.length < storedRowCount) {
    lines.push(
      `(first ${previewRows.length} of ${storedRowCount.toLocaleString("en-US")} rows; use ${handle} with read_result, run_js, make_chart, or export_table for the rest)`,
    );
  }
  return lines.join("\n");
}

function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

const maximumCellLength = 60;

function formatCell(value: JsonValue): string {
  if (value === null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length <= maximumCellLength ? oneLine : `${oneLine.slice(0, maximumCellLength)}…`;
}
