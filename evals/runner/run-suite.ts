// Runs every golden task several times (D33: 3 runs, pass on 2 of 3).

import type { GoldenTask, ScenarioId } from "../tasks/schema.ts";
import type { HarnessFactory } from "./harness.ts";
import { type RunOptions, type RunResult, runTaskOnce } from "./run-task.ts";

export const defaultRunsPerTask = 3;

export interface SuiteOptions extends RunOptions {
  /** The model the suite ran against, as the report should name it. */
  model: string;
  runsPerTask: number;
  /** Called after each run, for progress output. */
  onRunFinished?(task: GoldenTask, run: RunResult): void;
}

export interface TaskSummary {
  id: string;
  scenario: ScenarioId;
  title: string;
  chart: boolean;
}

export interface TaskResult {
  task: TaskSummary;
  status: "passed" | "failed" | "skipped";
  runs: RunResult[];
}

export interface SuiteResult {
  model: string;
  startedAt: string;
  finishedAt: string;
  runsPerTask: number;
  minimumPassingRuns: number;
  tasks: TaskResult[];
}

/** A majority of runs: 2 of 3 by default. */
export function minimumPassingRuns(runsPerTask: number): number {
  return Math.floor(runsPerTask / 2) + 1;
}

export async function runSuite(
  tasks: GoldenTask[],
  createHarness: HarnessFactory,
  options: SuiteOptions,
): Promise<SuiteResult> {
  const startedAt = new Date().toISOString();
  const results: TaskResult[] = [];
  for (const task of tasks) {
    results.push(await runTaskRepeatedly(task, createHarness, options));
  }
  return {
    model: options.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    runsPerTask: options.runsPerTask,
    minimumPassingRuns: minimumPassingRuns(options.runsPerTask),
    tasks: results,
  };
}

async function runTaskRepeatedly(
  task: GoldenTask,
  createHarness: HarnessFactory,
  options: SuiteOptions,
): Promise<TaskResult> {
  const runs: RunResult[] = [];
  for (let runIndex = 0; runIndex < options.runsPerTask; runIndex++) {
    const run = await runTaskOnce(task, createHarness, runIndex, options);
    runs.push(run);
    options.onRunFinished?.(task, run);
    // Missing tools do not appear between runs, so one skipped run skips the task.
    if (run.status === "skipped") break;
  }
  return { task: summarize(task), status: taskStatus(runs, options.runsPerTask), runs };
}

export function taskStatus(runs: RunResult[], runsPerTask: number): TaskResult["status"] {
  if (runs.some((run) => run.status === "skipped")) return "skipped";
  const passedRuns = runs.filter((run) => run.status === "passed").length;
  return passedRuns >= minimumPassingRuns(runsPerTask) ? "passed" : "failed";
}

function summarize(task: GoldenTask): TaskSummary {
  return { id: task.id, scenario: task.scenario, title: task.title, chart: task.chart };
}
