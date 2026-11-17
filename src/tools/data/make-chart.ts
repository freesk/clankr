// make_chart (DATA-10): the model writes JavaScript that builds Vega-Lite specs and calls
// render(spec, data("rN"), summary) once per chart. The code runs in the isolate; the specs are
// checked, themed, and drawn on the host. The file is a PDF, a Word document, an Excel
// workbook, or one PNG or SVG image; the user chooses which (D85). See specs/chart.md for the
// flow and the reasons.

import { dirname } from "node:path";
import { z } from "zod";
import { type ChartCodeRunner, runChartCode } from "../../chart/chart-code.ts";
import { type ChartFileRenderer, writeChartFile } from "../../chart/chart-file.ts";
import { writeCompanionFiles } from "../../chart/companion-files.ts";
import {
  baseNameFromTitle,
  type ChartOutputPaths,
  chooseOutputPaths,
  titleText,
} from "../../chart/output-naming.ts";
import { type PreparedChartPage, prepareCharts } from "../../chart/prepare-spec.ts";
import { type RowSources, traceRowSources } from "../../chart/provenance.ts";
import { failedCheckText, savedText } from "../../chart/result-text.ts";
import type { SelfCheck, SelfCheckVerdict } from "../../chart/self-check.ts";
import { loadTheme } from "../../chart/theme-loader.ts";
import {
  type OutputFormat,
  outputFormats,
  type Row,
  type Theme,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from "../../contracts/index.ts";
import { isolateLimitsFrom } from "../../engines/isolate/limits.ts";
import { chartOutputFormats, formatList, holdsSeveralCharts } from "../../output/formats.ts";
import { resolveUserPath, splitOutputPath } from "../../output/naming.ts";
import {
  askOutputFormat,
  type FormatRequest,
  settledOutputFormat,
} from "../../output/resolve-format.ts";

const parameters = z.object({
  code: z
    .string()
    .min(1)
    .describe('Builds Vega-Lite specs; calls render(spec, data("rN"), summary) once per chart'),
  format: z.enum(outputFormats).optional().describe("Only if the user named a format"),
  output_path: z.string().optional().describe("Default: next to the data file"),
});

type MakeChartArguments = z.infer<typeof parameters>;

export interface MakeChartDependencies extends ChartCodeRunner, ChartFileRenderer {
  /** Needed for the self-check only. */
  renderPreview?(
    spec: Record<string, unknown>,
    rows: Row[],
    theme: Theme,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  /** DATA-18. Leave out to skip the check, for example on a model without vision. */
  selfCheck?: SelfCheck;
}

const severalChartFormats = chartOutputFormats.filter(holdsSeveralCharts);

export function createMakeChartTool(
  dependencies: MakeChartDependencies,
): ToolDefinition<typeof parameters> {
  // D29: after one failed self-check, the next call is written whatever its verdict.
  let retryAfterFailedCheck = false;

  return {
    name: "make_chart",
    description:
      "Draw charts with JavaScript that renders Vega-Lite specs, saved as a file. " +
      "Give each chart a short summary of what it shows. Several charts go into one file, " +
      "a page each. Aggregate with query_sql first.",
    parameters,
    permission: "execute",
    resultTokenCap: 400,
    groups: ["data"],

    async previewChange(args, context) {
      const sources = await traceRowSources(args.code, context);
      const target = outputTarget(args, sources, context.workingDirectory);
      const settled = settledOutputFormat(formatRequest(args), context);
      const chart = settled
        ? `a ${settled.format.toUpperCase()} chart in ${target.folder}`
        : `a chart in ${target.folder} (you choose the format next)`;
      return {
        summary: `Run chart code and save ${chart}`,
        code: args.code,
        targetPaths: [target.explicitPath ?? target.folder],
        dataSourcePaths: sources.dataFiles,
      };
    },

    async run(args, context) {
      const { theme, problem: themeProblem } = await loadTheme(context.clankrPaths.themeFile);
      const limits = isolateLimitsFrom(context.config);
      const captured = await runChartCode(
        args.code,
        dependencies,
        context.results,
        limits,
        context.signal,
      );
      const sources = await traceRowSources(args.code, context);
      const request = formatRequest(args);
      const settled = settledOutputFormat(request, context);
      if (settled) assertHoldsCharts(settled.format, captured.charts.length);
      const prepared = await prepareCharts(captured.charts, { theme, rowCap: limits.rowCap });
      const charts = prepared.charts;

      const verdict = await runSelfCheck(charts, theme, context);
      if (verdict && !verdict.passed && !retryAfterFailedCheck) {
        retryAfterFailedCheck = true;
        return { text: failedCheckText(verdict) };
      }
      retryAfterFailedCheck = false;

      // The user is asked last, once the charts are known to be good, so a chart that fails
      // never costs them a question. Several charts are only offered formats that hold them.
      const offered = charts.length > 1 ? severalChartFormats : chartOutputFormats;
      const { format } = settled ?? (await askOutputFormat({ ...request, offered }, context));
      const target = outputTarget(args, sources, context.workingDirectory);
      const paths = await chooseChartPaths(target, format, charts);
      const rendered = await writeChartFile(dependencies, charts, theme, paths, context.signal);
      const specs = charts.map((chart) => chart.spec);
      const companions = await writeCompanionFiles(paths, args.code, specs, sources);
      const notes = [
        themeProblem,
        ...captured.notes,
        ...prepared.notes,
        ...(rendered.notes ?? []),
      ].filter((note): note is string => Boolean(note));
      const text = savedText({
        rendered,
        format: paths.format,
        companions,
        hasSummary: charts.map((chart) => Boolean(chart.summary)),
        verdict,
        notes,
        logs: captured.logs,
      });
      return { text };
    },
  };

  /**
   * Checks each chart's preview in order and stops at the first failure, which names the
   * chart when there are several. The one-retry rule (D29) is per call, not per chart.
   */
  async function runSelfCheck(
    charts: PreparedChartPage[],
    theme: Theme,
    context: ToolContext,
  ): Promise<SelfCheckVerdict | undefined> {
    const { selfCheck, renderPreview } = dependencies;
    if (!selfCheck || !renderPreview) return undefined;
    let last: SelfCheckVerdict | undefined;
    for (const [index, chart] of charts.entries()) {
      const preview = await renderPreview(chart.spec, chart.rows, theme, context.signal);
      const verdict = await selfCheck(preview, titleText(chart.spec), context);
      if (!verdict) return undefined;
      last = verdict;
      if (!verdict.passed && charts.length > 1) {
        return { passed: false, verdict: `chart ${index + 1}: ${verdict.verdict}` };
      }
      if (!verdict.passed) return verdict;
    }
    if (last && charts.length > 1) return { passed: true, verdict: `all ${charts.length} charts.` };
    return last;
  }
}

/** What the call says about the format, for the one resolution order every tool uses (D85). */
function formatRequest(args: MakeChartArguments): FormatRequest {
  return {
    what: "chart",
    allowed: chartOutputFormats,
    format: args.format,
    outputPath: args.output_path,
    unsupported: (format) =>
      `${format.toUpperCase()} holds a table, not a chart. Use export_table to save rows as ${format}, or a chart format: ${formatList(chartOutputFormats)}.`,
  };
}

function assertHoldsCharts(format: OutputFormat, chartCount: number): void {
  if (chartCount <= 1 || holdsSeveralCharts(format)) return;
  const name = format.toUpperCase();
  throw new ToolError(
    `${name} holds one chart, and the code rendered ${chartCount}. Use one make_chart call per ${name} chart, or a format that holds several: ${formatList(severalChartFormats)}.`,
  );
}

interface OutputTarget {
  folder: string;
  /** Set when the model named the output file. */
  explicitPath?: string;
}

/**
 * D28: an explicit path wins; otherwise the folder of the first data file the rows came from
 * (the decision for charts built from several files), or the working directory.
 */
function outputTarget(
  args: MakeChartArguments,
  sources: RowSources,
  workingDirectory: string,
): OutputTarget {
  if (args.output_path) {
    const explicitPath = resolveUserPath(args.output_path, workingDirectory);
    return { folder: dirname(explicitPath), explicitPath };
  }
  const firstDataFile = sources.dataFiles[0];
  return { folder: firstDataFile ? dirname(firstDataFile) : workingDirectory };
}

/** Named from the first chart's title when no path was given. */
function chooseChartPaths(
  target: OutputTarget,
  format: OutputFormat,
  charts: PreparedChartPage[],
): Promise<ChartOutputPaths> {
  const baseName = target.explicitPath
    ? splitOutputPath(target.explicitPath).baseName
    : baseNameFromTitle(charts[0]?.spec);
  return chooseOutputPaths(target.folder, baseName, format, charts.length);
}
