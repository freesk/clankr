// make_chart (DATA-10): the model writes JavaScript that builds Vega-Lite specs and calls
// render(spec, data("rN"), summary) once per chart. The code runs in the isolate; the specs are
// checked, themed, and drawn on the host. One chart prints on the theme's page; several print
// portrait, a page each, in one PDF. See specs/chart.md for the flow and the reasons.

import { dirname } from "node:path";
import { z } from "zod";
import { type ChartCodeRunner, runChartCode } from "../../chart/chart-code.ts";
import { writeCompanionFiles } from "../../chart/companion-files.ts";
import {
  baseNameFromTitle,
  type ChartOutputPaths,
  chooseOutputPaths,
  formatFromPath,
  resolveUserPath,
  splitOutputPath,
  titleText,
} from "../../chart/output-naming.ts";
import { type PreparedChartPage, prepareCharts } from "../../chart/prepare-spec.ts";
import { type RowSources, traceRowSources } from "../../chart/provenance.ts";
import { failedCheckText, savedText } from "../../chart/result-text.ts";
import type { SelfCheck, SelfCheckVerdict } from "../../chart/self-check.ts";
import { loadTheme } from "../../chart/theme-loader.ts";
import {
  type ChartFormat,
  type ChartPagesRequest,
  type ChartRenderRequest,
  type ChartRenderResult,
  type Row,
  type Theme,
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from "../../contracts/index.ts";
import { isolateLimitsFrom } from "../../engines/isolate/limits.ts";

const parameters = z.object({
  code: z
    .string()
    .min(1)
    .describe('Builds Vega-Lite specs; calls render(spec, data("rN"), summary) once per chart'),
  format: z.enum(["pdf", "png", "svg"]).optional().describe("Default pdf"),
  output_path: z.string().optional().describe("Default: next to the data file"),
});

type MakeChartArguments = z.infer<typeof parameters>;

export interface MakeChartDependencies extends ChartCodeRunner {
  renderChart(request: ChartRenderRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
  /** Several charts in one portrait PDF, a page each. */
  renderChartPages(request: ChartPagesRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
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

export function createMakeChartTool(
  dependencies: MakeChartDependencies,
): ToolDefinition<typeof parameters> {
  // D29: after one failed self-check, the next call is written whatever its verdict.
  let retryAfterFailedCheck = false;

  return {
    name: "make_chart",
    description:
      "Draw charts with JavaScript that renders Vega-Lite specs, saved as a file. " +
      "Give each chart a short summary of what it shows. Several charts go into one PDF, " +
      "a page each. Aggregate with query_sql first.",
    parameters,
    permission: "execute",
    resultTokenCap: 400,
    groups: ["data"],

    async previewChange(args, context) {
      const sources = await traceRowSources(args.code, context);
      const target = outputTarget(args, sources, context.workingDirectory);
      return {
        summary: `Run chart code and save a ${target.format.toUpperCase()} chart in ${target.folder}`,
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
      const target = outputTarget(args, sources, context.workingDirectory);
      if (captured.charts.length > 1 && target.format !== "pdf") {
        throw new ToolError(
          `Several charts go into one PDF, a page each; ${target.format.toUpperCase()} holds one chart. Use format "pdf", or one make_chart call per ${target.format.toUpperCase()} chart.`,
        );
      }
      const prepared = await prepareCharts(captured.charts, { theme, rowCap: limits.rowCap });
      const charts = prepared.charts;
      const paths = await chooseChartPaths(target, charts);

      const verdict = await runSelfCheck(charts, theme, context);
      if (verdict && !verdict.passed && !retryAfterFailedCheck) {
        retryAfterFailedCheck = true;
        return { text: failedCheckText(verdict) };
      }
      retryAfterFailedCheck = false;

      const rendered = await renderCharts(charts, theme, paths, context.signal);
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

  function renderCharts(
    charts: PreparedChartPage[],
    theme: Theme,
    paths: ChartOutputPaths,
    signal?: AbortSignal,
  ): Promise<ChartRenderResult> {
    const [only] = charts;
    if (only && charts.length === 1) {
      const request: ChartRenderRequest = {
        spec: only.spec,
        rows: only.rows,
        theme,
        format: paths.format,
        outputPath: paths.chart,
      };
      if (only.summary) request.summary = only.summary;
      return dependencies.renderChart(request, signal);
    }
    return dependencies.renderChartPages({ charts, theme, outputPath: paths.chart }, signal);
  }

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

interface OutputTarget {
  folder: string;
  format: ChartFormat;
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
    const format = formatFromPath(explicitPath) ?? args.format ?? "pdf";
    return { folder: dirname(explicitPath), format, explicitPath };
  }
  const firstDataFile = sources.dataFiles[0];
  const folder = firstDataFile ? dirname(firstDataFile) : workingDirectory;
  return { folder, format: args.format ?? "pdf" };
}

/** Named from the first chart's title when no path was given. */
function chooseChartPaths(
  target: OutputTarget,
  charts: PreparedChartPage[],
): Promise<ChartOutputPaths> {
  const baseName = target.explicitPath
    ? splitOutputPath(target.explicitPath).baseName
    : baseNameFromTitle(charts[0]?.spec);
  return chooseOutputPaths(target.folder, baseName, target.format, charts.length);
}
