// make_chart (DATA-10): the model writes JavaScript that builds a Vega-Lite spec and calls
// render(spec, data("rN")). The code runs in the isolate; the spec is checked, themed, and
// drawn on the host. See specs/chart.md for the flow and the reasons behind each step.

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
import { prepareChartSpec } from "../../chart/prepare-spec.ts";
import { type RowSources, traceRowSources } from "../../chart/provenance.ts";
import type { SelfCheck, SelfCheckVerdict } from "../../chart/self-check.ts";
import { loadTheme } from "../../chart/theme-loader.ts";
import type {
  ChartFormat,
  ChartRenderRequest,
  ChartRenderResult,
  Row,
  Theme,
  ToolContext,
  ToolDefinition,
} from "../../contracts/index.ts";
import { isolateLimitsFrom } from "../../engines/isolate/limits.ts";

const parameters = z.object({
  code: z.string().min(1).describe('Builds a Vega-Lite spec and calls render(spec, data("rN"))'),
  format: z.enum(["pdf", "png", "svg"]).optional().describe("Default pdf"),
  output_path: z.string().optional().describe("Default: next to the data file"),
});

type MakeChartArguments = z.infer<typeof parameters>;

export interface MakeChartDependencies extends ChartCodeRunner {
  renderChart(request: ChartRenderRequest, signal?: AbortSignal): Promise<ChartRenderResult>;
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
  // D29: after one failed self-check, the next chart is written whatever its verdict.
  let retryAfterFailedCheck = false;

  return {
    name: "make_chart",
    description:
      "Draw a chart with JavaScript that renders a Vega-Lite spec, saved as a file. " +
      "Aggregate with query_sql first.",
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
      const prepared = await prepareChartSpec(captured.spec, captured.rows, {
        theme,
        rowCap: limits.rowCap,
      });
      const sources = await traceRowSources(args.code, context);
      const paths = await chooseChartPaths(args, sources, context.workingDirectory, prepared.spec);

      const verdict = await runSelfCheck(prepared.spec, captured.rows, theme, context);
      if (verdict && !verdict.passed && !retryAfterFailedCheck) {
        retryAfterFailedCheck = true;
        return { text: failedCheckText(verdict) };
      }
      retryAfterFailedCheck = false;

      const rendered = await dependencies.renderChart(
        {
          spec: prepared.spec,
          rows: captured.rows,
          theme,
          format: paths.format,
          outputPath: paths.chart,
        },
        context.signal,
      );
      const companions = await writeCompanionFiles(paths, args.code, prepared.spec, sources);
      const notes = [themeProblem, ...prepared.notes, ...(rendered.notes ?? [])].filter(
        (note): note is string => Boolean(note),
      );
      return { text: savedText(rendered, companions, verdict, notes, captured.logs) };
    },
  };

  async function runSelfCheck(
    spec: Record<string, unknown>,
    rows: Row[],
    theme: Theme,
    context: ToolContext,
  ): Promise<SelfCheckVerdict | undefined> {
    const { selfCheck, renderPreview } = dependencies;
    if (!selfCheck || !renderPreview) return undefined;
    const preview = await renderPreview(spec, rows, theme, context.signal);
    return selfCheck(preview, titleText(spec), context);
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

function chooseChartPaths(
  args: MakeChartArguments,
  sources: RowSources,
  workingDirectory: string,
  spec: Record<string, unknown>,
): Promise<ChartOutputPaths> {
  const target = outputTarget(args, sources, workingDirectory);
  const baseName = target.explicitPath
    ? splitOutputPath(target.explicitPath).baseName
    : baseNameFromTitle(spec);
  return chooseOutputPaths(target.folder, baseName, target.format);
}

function failedCheckText(verdict: SelfCheckVerdict): string {
  return [
    `Self-check failed: ${verdict.verdict}`,
    "Nothing was saved. Fix the chart and call make_chart once more; that chart will be saved.",
  ].join("\n");
}

function savedText(
  rendered: ChartRenderResult,
  companions: string[],
  verdict: SelfCheckVerdict | undefined,
  notes: string[],
  logs: string[],
): string {
  const lines = [`Saved chart: ${rendered.path} (${formatSize(rendered.sizeBytes)})`];
  lines.push(`Saved beside it: ${companions.join(", ")}`);
  if (verdict) lines.push(`Self-check ${verdict.passed ? "passed" : "failed"}: ${verdict.verdict}`);
  if (notes.length > 0) lines.push(`Notes: ${notes.slice(0, 5).join(" ")}`);
  if (logs.length > 0) lines.push(`Console output:\n${logs.slice(-5).join("\n")}`);
  return lines.join("\n");
}

function formatSize(sizeBytes: number): string {
  return sizeBytes < 1024 ? `${sizeBytes} B` : `${Math.round(sizeBytes / 1024)} KB`;
}
