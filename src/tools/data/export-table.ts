// export_table: saves a stored row set (a query_sql or run_js result) as a file the user can
// open in Excel or Word, or as a PDF or CSV. No model-written code runs here: the tool only
// writes rows that an approved query already produced, so it is a write, judged by where the
// file goes (D89). The user chooses the format (D85). See specs/output.md.

import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { traceHandleSources } from "../../chart/provenance.ts";
import { loadTheme } from "../../chart/theme-loader.ts";
import {
  type ChartRenderResult,
  type OutputFormat,
  outputFormatLabels,
  outputFormats,
  type ResultMeta,
  type Row,
  type TableRenderRequest,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from "../../contracts/index.ts";
import { formatFileSize, pageCountText } from "../../output/file-facts.ts";
import { formatList, tableOutputFormats } from "../../output/formats.ts";
import {
  firstFreeName,
  resolveUserPath,
  slugFromTitle,
  splitOutputPath,
} from "../../output/naming.ts";
import {
  type FormatRequest,
  resolveOutputFormat,
  settledOutputFormat,
} from "../../output/resolve-format.ts";
import { describeTable, type TableData, textGrid } from "../../output/table-data.ts";
import {
  numericColumnsOf,
  writeTableCsv,
  writeTableDocument,
  writeTableWorkbook,
} from "../../output/table-files.ts";

const parameters = z.object({
  handle: z.string().min(1).describe('A query_sql or run_js result, such as "r3"'),
  title: z.string().optional().describe("Heading and file name"),
  format: z.enum(outputFormats).optional().describe("Only if the user named a format"),
  output_path: z.string().optional().describe("Default: next to the data file"),
});

type ExportTableArguments = z.infer<typeof parameters>;

export interface ExportTableDependencies {
  /** The PDF table is drawn by the offline browser; no model-written code runs in it. */
  renderTable(request: TableRenderRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
}

export function createExportTableTool(
  dependencies: ExportTableDependencies,
): ToolDefinition<typeof parameters> {
  return {
    name: "export_table",
    description:
      "Save a stored row set as an Excel, Word, PDF, or CSV file. " +
      "Word and PDF tables hold few rows, so aggregate with query_sql first.",
    parameters,
    permission: "write",
    resultTokenCap: 300,
    groups: ["data"],
    keyArgument: "handle",

    async previewChange(args, context) {
      const meta = await describeRowSet(args.handle, context);
      const target = await outputTarget(args, context);
      const settled = settledOutputFormat(formatRequest(args), context);
      const file = settled
        ? `${articleFor(settled.format)} ${settled.format.toUpperCase()} file`
        : "a file (you choose the format next)";
      return {
        summary: `Export ${sizeText(meta)} from ${args.handle} to ${file} in ${target.folder}`,
        targetPaths: [target.explicitPath ?? target.folder],
        dataSourcePaths: target.dataFiles,
      };
    },

    async run(args, context) {
      const meta = await describeRowSet(args.handle, context);
      const target = await outputTarget(args, context);
      const { format } = await resolveOutputFormat(formatRequest(args), context);
      assertFits(meta.itemCount, format, context);
      const title = args.title?.trim() || defaultTitle(target.dataFiles);
      const baseName = target.explicitPath
        ? splitOutputPath(target.explicitPath).baseName
        : slugFromTitle(title, "table");
      const outputPath = await freeOutputPath(target.folder, baseName, format);
      const written = await writeTable({ meta, title, format, outputPath }, context);
      return { text: savedText(written, meta, format) };
    },
  };

  async function writeTable(
    job: { meta: ResultMeta; title: string; format: OutputFormat; outputPath: string },
    context: ToolContext,
  ): Promise<ChartRenderResult> {
    const { meta, title, format, outputPath } = job;
    if (format === "csv") {
      const rows = context.results.readRows(meta.handle);
      return writeTableCsv(meta.columns ?? [], rows, outputPath);
    }
    const table = await readTable(meta, context);
    if (format === "xlsx") return writeTableWorkbook({ title, table }, outputPath);
    const { theme, problem } = await loadTheme(context.clankrPaths.themeFile);
    const written =
      format === "docx"
        ? await writeTableDocument({ title, table }, theme, outputPath)
        : await dependencies.renderTable(
            {
              title,
              columns: table.columns.map((column) => column.name),
              cells: textGrid(table),
              numericColumns: numericColumnsOf(table),
              theme,
              outputPath,
            },
            context.signal,
          );
    const notes = [problem, ...(written.notes ?? [])].filter((note) => note !== undefined);
    return notes.length > 0 ? { ...written, notes } : written;
  }
}

function formatRequest(args: ExportTableArguments): FormatRequest {
  return {
    what: "table",
    allowed: tableOutputFormats,
    format: args.format,
    outputPath: args.output_path,
    unsupported: (format) =>
      `${format.toUpperCase()} is a picture, and export_table writes tables. Use make_chart to draw a chart, or a table format: ${formatList(tableOutputFormats)}.`,
  };
}

async function describeRowSet(handle: string, context: ToolContext): Promise<ResultMeta> {
  const meta = await context.results.describe(handle).catch(() => undefined);
  if (meta?.kind !== "rows") {
    throw new ToolError(
      `"${handle}" is not a stored row set. Pass the handle query_sql or run_js returned, such as "r3".`,
    );
  }
  if (meta.itemCount === 0 || (meta.columns ?? []).length === 0) {
    throw new ToolError(`${handle} has no rows, so there is nothing to export.`);
  }
  return meta;
}

interface OutputTarget {
  folder: string;
  /** Set when the model named the output file. */
  explicitPath?: string;
  /** The data files the rows came from, for the preview and the default name. */
  dataFiles: string[];
}

/** D28, as for charts: an explicit path wins, else beside the first data file, else here. */
async function outputTarget(
  args: ExportTableArguments,
  context: ToolContext,
): Promise<OutputTarget> {
  const { dataFiles } = await traceHandleSources([args.handle], context);
  if (args.output_path) {
    const explicitPath = resolveUserPath(args.output_path, context.workingDirectory);
    return { folder: dirname(explicitPath), explicitPath, dataFiles };
  }
  const firstDataFile = dataFiles[0];
  const folder = firstDataFile ? dirname(firstDataFile) : context.workingDirectory;
  return { folder, dataFiles };
}

/** Without a title the table is named after its data file, so "sales.csv" gives "sales". */
function defaultTitle(dataFiles: string[]): string {
  const firstDataFile = dataFiles[0];
  return firstDataFile ? basename(firstDataFile, extname(firstDataFile)) : "Table";
}

/** Never overwrites (D28): "sales.xlsx", then "sales-2.xlsx". Matters beside "sales.csv" too. */
async function freeOutputPath(
  folder: string,
  baseName: string,
  format: OutputFormat,
): Promise<string> {
  const pathFor = (name: string) => join(folder, `${name}.${format}`);
  return pathFor(await firstFreeName(folder, baseName, (name) => [pathFor(name)]));
}

/** A table in a document is for reading; a sheet holds what Excel can hold. */
function assertFits(rowCount: number, format: OutputFormat, context: ToolContext): void {
  const { maxDocumentTableRows, maxSheetRows } = context.config.output;
  const limit =
    format === "xlsx" ? maxSheetRows : format === "csv" ? undefined : maxDocumentTableRows;
  if (limit === undefined || rowCount <= limit) return;
  const larger = format === "xlsx" ? "csv" : "xlsx or csv";
  throw new ToolError(
    `The row set has ${count(rowCount)} rows; ${articleFor(format)} ${format.toUpperCase()} table holds at most ${count(limit)}. ` +
      `Aggregate first with query_sql (GROUP BY, or ORDER BY with LIMIT), then export the smaller result, or use format ${larger}.`,
  );
}

async function readTable(meta: ResultMeta, context: ToolContext): Promise<TableData> {
  const rows: Row[] = [];
  for await (const row of context.results.readRows(meta.handle)) rows.push(row);
  return describeTable(rows, meta.columns);
}

function savedText(written: ChartRenderResult, meta: ResultMeta, format: OutputFormat): string {
  const facts = [
    formatFileSize(written.sizeBytes),
    outputFormatLabels[format],
    pageCountText(written),
  ].filter((fact) => fact !== undefined);
  const lines = [`Saved table: ${written.path} (${facts.join(", ")})`, `${sizeText(meta)}.`];
  if (format === "xlsx") lines.push("Numbers and dates are typed cells, with a header row.");
  if (written.notes && written.notes.length > 0) lines.push(`Notes: ${written.notes.join(" ")}`);
  return lines.join("\n");
}

function sizeText(meta: ResultMeta): string {
  const columnCount = meta.columns?.length ?? 0;
  return `${count(meta.itemCount)} ${meta.itemCount === 1 ? "row" : "rows"}, ${columnCount} ${columnCount === 1 ? "column" : "columns"}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function articleFor(format: OutputFormat): string {
  return format === "xlsx" ? "an" : "a";
}
