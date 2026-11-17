// Profiling one detected file: plan its tables, store the ones that become row sets,
// name them, and profile each through a short-lived locked DuckDB instance that may
// read only this file (or its row sets). The session's query engine is separate.

import { basename } from "node:path";
import type { DataTable, ResultHandle, ToolContext } from "../../../contracts/index.ts";
import { allocateTableNames } from "../../../data/index.ts";
import {
  type LockedDatabase,
  openLockedDatabase,
  readsExcel,
  type TableSourceInput,
  tableSourceSql,
  withQueryLimits,
} from "../../../engines/duckdb/index.ts";
import { type ProfileSource, profileTable } from "./column-profile.ts";
import type { DetectedFormat } from "./detect-format.ts";
import type { FileProfile, TableProfile } from "./profile-format.ts";
import {
  assertKnownLabel,
  type HeaderRowFor,
  planDelimited,
  planDocx,
  planXls,
  type TablePlan,
} from "./table-plans.ts";
import { isUtf8File, writeUtf8Copy } from "./text-encoding.ts";
import { planXlsx } from "./xlsx-plan.ts";

export interface ProfileRequest {
  realPath: string;
  sizeBytes: number;
  detected: DetectedFormat;
  sheet?: string;
  headerRow?: number;
}

export interface ProfiledFile {
  profile: FileProfile;
  tables: DataTable[];
  rowSetHandles: ResultHandle[];
}

export async function profileFile(
  request: ProfileRequest,
  context: ToolContext,
): Promise<ProfiledFile> {
  const headerRowFor: HeaderRowFor = (label) =>
    request.sheet === undefined || request.sheet === label ? request.headerRow : undefined;
  const { format } = request.detected;
  const readsInPlace = format === "csv" || format === "tsv" || format === "xlsx";

  const converted = readsInPlace ? undefined : await planConverted(request, headerRowFor);
  const rowSetHandles = converted ? await storeRowSets(converted.plans, request, context) : [];
  const utf8CopyPath = await utf8CopyIfNeeded(request, context);
  const database = await openLockedDatabase({
    allowedFiles: readsInPlace
      ? [utf8CopyPath ?? request.realPath]
      : rowSetFiles(rowSetHandles, context),
    scratchDirectory: context.clankrPaths.session.scratch,
    memoryLimitMb: context.config.data.sqlMemoryLimitMb,
    loadExcelReader: format === "xlsx",
  });
  try {
    return await withQueryLimits(
      database.connection,
      { timeoutMs: context.config.data.sqlTimeoutMs, signal: context.signal },
      async () => {
        const plans =
          converted?.plans ?? (await planInPlace(database, request, headerRowFor, utf8CopyPath));
        assertKnownLabel(plans, request.sheet);
        const tables = nameTables(plans, rowSetHandles, request, context);
        const tableProfiles = await profilePlans(database, plans, tables, request, context);
        const profile: FileProfile = {
          realPath: request.realPath,
          format,
          sizeBytes: request.sizeBytes,
          tables: tableProfiles,
        };
        if (request.detected.mismatchNote) profile.mismatchNote = request.detected.mismatchNote;
        if (converted?.headings) profile.headings = converted.headings;
        return { profile, tables, rowSetHandles };
      },
    );
  } finally {
    database.close();
  }
}

interface ConvertedPlans {
  plans: TablePlan[];
  headings?: { level: number; text: string }[];
}

async function planConverted(
  request: ProfileRequest,
  headerRowFor: HeaderRowFor,
): Promise<ConvertedPlans> {
  if (request.detected.format === "xls")
    return { plans: await planXls(request.realPath, headerRowFor) };
  return planDocx(request.realPath, headerRowFor);
}

async function planInPlace(
  database: LockedDatabase,
  request: ProfileRequest,
  headerRowFor: HeaderRowFor,
  utf8CopyPath: string | undefined,
): Promise<TablePlan[]> {
  if (request.detected.format === "xlsx") {
    return planXlsx(database.connection, request.realPath, headerRowFor);
  }
  return planDelimited(request.realPath, request.detected, headerRowFor, utf8CopyPath);
}

/** A delimited file that is not UTF-8 is read through a converted copy (see text-encoding.ts). */
async function utf8CopyIfNeeded(
  request: ProfileRequest,
  context: ToolContext,
): Promise<string | undefined> {
  const { format } = request.detected;
  if (format !== "csv" && format !== "tsv") return undefined;
  if (await isUtf8File(request.realPath)) return undefined;
  return writeUtf8Copy(request.realPath, context.clankrPaths.session.scratch);
}

/** One handle per plan with data, in plan order. */
async function storeRowSets(
  plans: TablePlan[],
  request: ProfileRequest,
  context: ToolContext,
): Promise<ResultHandle[]> {
  const handles: ResultHandle[] = [];
  for (const plan of plans.filter((candidate) => candidate.hasData && candidate.rows)) {
    handles.push(
      await context.results.putRows(plan.rows?.rows ?? [], {
        tool: "inspect_data",
        arguments: { path: request.realPath },
        label: `${basename(request.realPath)} ${plan.description}`,
        dataSourcePaths: [request.realPath],
      }),
    );
  }
  return handles;
}

function profileSource(input: TableSourceInput): ProfileSource {
  const sql = tableSourceSql(input);
  if (!readsExcel(input)) return { sql };
  return {
    sql,
    mixedCheck: {
      strictSql: tableSourceSql(input, { xlsxMode: "strict" }),
      textSql: tableSourceSql(input, { xlsxMode: "text" }),
    },
  };
}

function rowSetFiles(handles: ResultHandle[], context: ToolContext): string[] {
  return handles.map((handle) => {
    const path = context.results.rowsFilePath?.(handle);
    if (!path) throw new Error("The result store keeps no files, so DuckDB cannot read row sets");
    return path;
  });
}

/** SQL names for the plans that have data; plans without data get no table. */
function nameTables(
  plans: TablePlan[],
  rowSetHandles: ResultHandle[],
  request: ProfileRequest,
  context: ToolContext,
): DataTable[] {
  const withData = plans.filter((plan) => plan.hasData);
  const names = allocateTableNames(
    context.dataSources,
    request.realPath,
    withData.map((plan) => plan.label),
  );
  return withData.map((plan, index): DataTable => {
    const table: DataTable = { sqlName: names[index] ?? plan.label, label: plan.label };
    const rowsHandle = rowSetHandles[index];
    if (plan.rows && rowsHandle) table.rowsHandle = rowsHandle;
    if (plan.layout) table.layout = plan.layout;
    return table;
  });
}

async function profilePlans(
  database: LockedDatabase,
  plans: TablePlan[],
  tables: DataTable[],
  request: ProfileRequest,
  context: ToolContext,
): Promise<TableProfile[]> {
  const profiles: TableProfile[] = [];
  let tableIndex = 0;
  for (const plan of plans) {
    const base = { description: plan.description, headerRow: plan.headerRow };
    const table = plan.hasData ? tables[tableIndex++] : undefined;
    if (!table) {
      profiles.push({ ...base, rowCount: 0, columns: [] });
      continue;
    }
    const input: TableSourceInput = {
      format: request.detected.format,
      realPath: request.realPath,
      table,
      rowsFilePath: table.rowsHandle ? context.results.rowsFilePath?.(table.rowsHandle) : undefined,
    };
    const statistics = await profileWithFullTypeScan(database, input);
    profiles.push({ ...base, sqlName: table.sqlName, ...statistics });
  }
  return profiles;
}

/**
 * DuckDB guesses a delimited file's column types from its first rows. When a later value
 * breaks the guess (an Age column that reads `90+` after 86,000 numbers), the table is
 * profiled again with types guessed from every row. The layout keeps that choice, so
 * query_sql reads the file the same way.
 */
async function profileWithFullTypeScan(database: LockedDatabase, input: TableSourceInput) {
  try {
    return await profileTable(database.connection, profileSource(input));
  } catch (error) {
    const layout = input.table.layout;
    const delimited = input.format === "csv" || input.format === "tsv";
    if (!delimited || !layout || layout.scanAllRowsForTypes || !isTypeGuessError(error)) {
      throw error;
    }
    layout.scanAllRowsForTypes = true;
    return profileTable(database.connection, profileSource(input));
  }
}

function isTypeGuessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CSV Error on Line|Conversion Error|Could not convert/i.test(message);
}
