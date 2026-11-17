// The per-run report: a Markdown summary for people and the full JSON result
// for later comparison, both saved in evals/reports/ (D33).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultConfig } from "../../src/config/index.ts";
import type { SuiteResult, TaskResult } from "../runner/run-suite.ts";
import { metricTargets, type Ratio, type SuiteMetrics } from "./compute.ts";

/** The model the PRD's targets are stated for. */
export const targetModel = defaultConfig().model.default;

export function renderMarkdownReport(suite: SuiteResult, metrics: SuiteMetrics): string {
  return [
    `# Golden suite: ${suite.model}`,
    "",
    `Run from ${suite.startedAt} to ${suite.finishedAt}. ${suite.runsPerTask} runs per task; a task passes on ${suite.minimumPassingRuns}.`,
    "",
    targetModelNote(suite.model),
    "",
    "## Metrics (PRD section 10)",
    "",
    ...metricsTable(metrics),
    "",
    "## Tasks",
    "",
    ...taskTable(suite.tasks),
    "",
    ...failureSection(suite.tasks),
    ...skippedSection(suite.tasks),
  ].join("\n");
}

function targetModelNote(model: string): string {
  if (model === targetModel) return `Run against the target model, ${targetModel}.`;
  return `**Not the target model.** This run used ${model}; the targets are stated for ${targetModel} and are not yet verified by this report.`;
}

function metricsTable(metrics: SuiteMetrics): string[] {
  const rows = [
    [
      "Golden task pass rate",
      formatRatio(metrics.taskPassRate),
      `≥ ${percent(metricTargets.taskPassRate)}`,
      meets(metrics.taskPassRate, metricTargets.taskPassRate),
    ],
    ["Run pass rate (all runs)", formatRatio(metrics.runPassRate), "reported", "-"],
    [
      "Tool calls valid on the first attempt",
      formatRatio(metrics.firstAttemptValidRate),
      `≥ ${percent(metricTargets.firstAttemptValidRate)}`,
      meets(metrics.firstAttemptValidRate, metricTargets.firstAttemptValidRate),
    ],
    ["Tool calls valid or repaired", formatRatio(metrics.validOrRepairedRate), "reported", "-"],
    [
      "Charts rendered within 3 attempts",
      formatRatio(metrics.chartWithinAttemptsRate),
      `≥ ${percent(metricTargets.chartWithinAttemptsRate)}`,
      meets(metrics.chartWithinAttemptsRate, metricTargets.chartWithinAttemptsRate),
    ],
    [
      "Median tokens sent per completed task",
      metrics.medianTokensPerCompletedTask?.toString() ?? "not measured",
      "tracked",
      "-",
    ],
    [
      "Runs that hit a context overflow",
      String(metrics.contextOverflowRuns),
      "0",
      yesNo(metrics.contextOverflowRuns === 0),
    ],
    [
      "Outbound connections outside LM Studio",
      metrics.outboundConnections?.toString() ?? "not measured",
      "0",
      metrics.outboundConnections === undefined
        ? "not measured"
        : yesNo(metrics.outboundConnections === 0),
    ],
  ];
  const notes = [];
  if (metrics.callsWithoutValidity > 0) {
    notes.push(
      "",
      `${metrics.callsWithoutValidity} tool calls reported no validity and are left out of the validity rates.`,
    );
  }
  if (metrics.skippedTasks > 0) {
    notes.push("", `${metrics.skippedTasks} tasks were skipped and are left out of every rate.`);
  }
  return [
    "| Metric | Value | Target | Met |",
    "|---|---|---|---|",
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
    ...notes,
  ];
}

function taskTable(tasks: TaskResult[]): string[] {
  return [
    "| Task | Scenario | Status | Runs passed |",
    "|---|---|---|---|",
    ...tasks.map((result) => {
      const passed = result.runs.filter((run) => run.status === "passed").length;
      const runs = result.status === "skipped" ? "-" : `${passed} / ${result.runs.length}`;
      return `| ${result.task.id} | ${result.task.scenario} | ${result.status} | ${runs} |`;
    }),
  ];
}

function failureSection(tasks: TaskResult[]): string[] {
  const lines: string[] = [];
  for (const result of tasks) {
    for (const run of result.runs.filter((candidate) => candidate.status === "failed")) {
      lines.push(`- **${result.task.id}** run ${run.runIndex + 1}: ${run.failures.join("; ")}`);
    }
  }
  return lines.length === 0 ? [] : ["## Failed runs", "", ...lines, ""];
}

function skippedSection(tasks: TaskResult[]): string[] {
  const lines = tasks
    .filter((result) => result.status === "skipped")
    .map(
      (result) =>
        `- **${result.task.id}**: missing ${result.runs[0]?.missingRequirements.join(", ")}`,
    );
  return lines.length === 0 ? [] : ["## Skipped tasks", "", ...lines, ""];
}

function formatRatio(value: Ratio): string {
  if (value.rate === undefined) return "not measured";
  return `${percent(value.rate)} (${value.numerator} / ${value.denominator})`;
}

function meets(value: Ratio, target: number): string {
  return value.rate === undefined ? "not measured" : yesNo(value.rate >= target);
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function yesNo(condition: boolean): string {
  return condition ? "yes" : "no";
}

export interface WrittenReport {
  markdownPath: string;
  jsonPath: string;
}

/** Saves `<timestamp>-<model>.md` and `.json` in the directory. */
export async function writeReport(
  directory: string,
  suite: SuiteResult,
  metrics: SuiteMetrics,
): Promise<WrittenReport> {
  await mkdir(directory, { recursive: true });
  const baseName = `${suite.startedAt.replace(/[:.]/g, "-")}-${suite.model.replace(/[^A-Za-z0-9.-]+/g, "_")}`;
  const markdownPath = join(directory, `${baseName}.md`);
  const jsonPath = join(directory, `${baseName}.json`);
  await writeFile(markdownPath, renderMarkdownReport(suite, metrics));
  await writeFile(jsonPath, `${JSON.stringify({ metrics, suite }, null, 2)}\n`);
  return { markdownPath, jsonPath };
}
