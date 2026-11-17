// `inspect_data` (DATA-1 to DATA-5): detect a data file's real format, profile it, and
// register its tables so query_sql can read them. The profile is the only view of the
// data the model gets; the full profile is stored, and the registration is DuckDB's
// allow-list (DATA-7).

import { stat } from "node:fs/promises";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolOutput } from "../../../contracts/index.ts";
import { ToolError } from "../../../contracts/index.ts";
import { QueryInterruptedError, stripPaths } from "../../../engines/duckdb/index.ts";
import { detectFormat } from "./detect-format.ts";
import { type CacheKey, cachedProfile, rememberProfile } from "./profile-cache.ts";
import { profileFile } from "./profile-file.ts";
import { formatProfile } from "./profile-format.ts";

const parameters = z.object({
  path: z.string().min(1).describe("A .xlsx, .xls, .csv, .tsv, or .docx file."),
  sheet: z.string().optional().describe("Sheet or table label that headerRow applies to."),
  headerRow: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based header row, only when the detected one is wrong."),
});

type InspectArguments = z.infer<typeof parameters>;

export const inspectDataTool: ToolDefinition<typeof parameters> = {
  name: "inspect_data",
  description:
    "Profile a spreadsheet, CSV/TSV, or Word file: sheets, columns, types, and samples. Prints the SQL table names that query_sql uses.",
  parameters,
  permission: "read",
  resultTokenCap: 1_500,
  groups: ["data"],
  keyArgument: "path",
  run: inspectData,
};

async function inspectData(args: InspectArguments, context: ToolContext): Promise<ToolOutput> {
  const { realPath, pathClass } = await context.paths.classify(args.path);
  if (pathClass === "denied") {
    throw new ToolError(`${args.path} is on the protected list and cannot be read.`);
  }
  const cacheKey = await cacheKeyFor(realPath, args);
  const cached = cachedProfile(context.dataSources, cacheKey);
  if (cached) return cached;

  const detected = await detectFormat(realPath);
  const profiled = await profileFile(
    { realPath, sizeBytes: cacheKey.sizeBytes, detected, ...overrides(args) },
    context,
  ).catch((error: unknown) => {
    throw profilingError(error, context);
  });
  const { config } = context;
  const sensitiveColumns = new Set(config.data.sensitiveColumns.map((name) => name.toLowerCase()));
  const profileHandle = await context.results.putText(
    formatProfile(profiled.profile, { sensitiveColumns }),
    {
      tool: "inspect_data",
      arguments: args,
      label: `inspect_data ${args.path}`,
      dataSourcePaths: [realPath],
    },
  );
  context.dataSources.register({
    handle: profileHandle,
    realPath,
    format: detected.format,
    tables: profiled.tables,
  });
  const output: ToolOutput = {
    text: formatProfile(profiled.profile, {
      sensitiveColumns,
      columnsShown: config.data.profileColumnsShown,
      profileHandle,
    }),
    handles: [profileHandle, ...profiled.rowSetHandles],
  };
  rememberProfile(context.dataSources, cacheKey, output);
  return output;
}

/** DuckDB's and SheetJS's messages carry paths and internals; keep one short line. */
function profilingError(error: unknown, context: ToolContext): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof QueryInterruptedError) {
    return new ToolError(
      error.reason === "cancelled"
        ? "Inspection was cancelled."
        : `Profiling took longer than ${context.config.data.sqlTimeoutMs / 1000} s and was stopped.`,
    );
  }
  const firstLine = stripPaths(
    (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "",
  );
  return new ToolError(`The file could not be profiled: ${firstLine.slice(0, 200)}`);
}

function overrides(args: InspectArguments): { sheet?: string; headerRow?: number } {
  return {
    ...(args.sheet !== undefined ? { sheet: args.sheet } : {}),
    ...(args.headerRow !== undefined ? { headerRow: args.headerRow } : {}),
  };
}

async function cacheKeyFor(realPath: string, args: InspectArguments): Promise<CacheKey> {
  const stats = await stat(realPath).catch(() => {
    throw new ToolError(`No file at ${args.path}. Check the path with find_files.`);
  });
  if (!stats.isFile()) throw new ToolError(`${args.path} is a folder, not a data file.`);
  return {
    realPath,
    sizeBytes: stats.size,
    modifiedTimeMs: stats.mtimeMs,
    options: JSON.stringify(overrides(args)),
  };
}
