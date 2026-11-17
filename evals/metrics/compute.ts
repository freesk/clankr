// The six metrics of PRD section 10, computed from a suite result alone: the
// event stream, the token tally, and the network test's count.

import type { SuiteResult } from "../runner/run-suite.ts";
import type { RunResult, RunStatus } from "../runner/run-task.ts";
import type { ToolCallRecord } from "../runner/transcript.ts";

export const chartToolName = "make_chart";
export const chartAttemptLimit = 3;

/** Targets from PRD section 10. */
export const metricTargets = {
  taskPassRate: 0.8,
  firstAttemptValidRate: 0.95,
  chartWithinAttemptsRate: 0.9,
  contextOverflowRuns: 0,
  outboundConnections: 0,
} as const;

export interface Ratio {
  numerator: number;
  denominator: number;
  /** Undefined when the denominator is zero: nothing to measure. */
  rate: number | undefined;
}

export interface SuiteMetrics {
  /** Tasks passing at least the minimum number of runs, over tasks not skipped. */
  taskPassRate: Ratio;
  /** Runs that passed, over runs not skipped. */
  runPassRate: Ratio;
  /** Calls whose first attempt was valid as written, over calls reporting validity. */
  firstAttemptValidRate: Ratio;
  /** As above, but counting calls the loop repaired as valid. */
  validOrRepairedRate: Ratio;
  /** Tool calls whose tool-end carried no validity, so they are left out of both rates. */
  callsWithoutValidity: number;
  /** Chart task runs where make_chart succeeded within the attempt limit. */
  chartWithinAttemptsRate: Ratio;
  /** Median prompt tokens sent, over runs that passed. */
  medianTokensPerCompletedTask: number | undefined;
  contextOverflowRuns: number;
  /** From the network test; undefined when it was not run with the suite. */
  outboundConnections: number | undefined;
  skippedTasks: number;
}

export function computeMetrics(suite: SuiteResult, outboundConnections?: number): SuiteMetrics {
  const measuredTasks = suite.tasks.filter((task) => task.status !== "skipped");
  const measuredRuns = measuredTasks.flatMap((task) => task.runs);
  const toolCalls = measuredRuns.flatMap((run) => run.toolCalls);
  const callsWithValidity = toolCalls.filter((call) => call.validity !== undefined);
  const chartRuns = measuredTasks.filter((task) => task.task.chart).flatMap((task) => task.runs);
  return {
    taskPassRate: ratio(
      countWhere(measuredTasks, (task) => task.status === "passed"),
      measuredTasks.length,
    ),
    runPassRate: ratio(countRunsWithStatus(measuredRuns, "passed"), measuredRuns.length),
    firstAttemptValidRate: ratio(
      countWhere(callsWithValidity, (call) => call.validity === "valid"),
      callsWithValidity.length,
    ),
    validOrRepairedRate: ratio(
      countWhere(callsWithValidity, (call) => call.validity !== "invalid"),
      callsWithValidity.length,
    ),
    callsWithoutValidity: toolCalls.length - callsWithValidity.length,
    chartWithinAttemptsRate: ratio(
      countWhere(chartRuns, chartRenderedWithinLimit),
      chartRuns.length,
    ),
    medianTokensPerCompletedTask: median(
      measuredRuns.filter((run) => run.status === "passed").map((run) => run.tokensSent),
    ),
    contextOverflowRuns: countWhere(measuredRuns, (run) => run.contextOverflow),
    outboundConnections,
    skippedTasks: suite.tasks.length - measuredTasks.length,
  };
}

/** A chart request succeeds when one of its first three make_chart calls finished without error. */
export function chartRenderedWithinLimit(run: RunResult): boolean {
  const attempts = run.toolCalls.filter((call) => call.tool === chartToolName);
  return attempts.slice(0, chartAttemptLimit).some(isSuccessfulCall);
}

function isSuccessfulCall(call: ToolCallRecord): boolean {
  return call.finished && call.error === undefined;
}

export function ratio(numerator: number, denominator: number): Ratio {
  return { numerator, denominator, rate: denominator === 0 ? undefined : numerator / denominator };
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function countRunsWithStatus(runs: RunResult[], status: RunStatus): number {
  return countWhere(runs, (run) => run.status === status);
}

function countWhere<Item>(items: Item[], predicate: (item: Item) => boolean): number {
  return items.filter(predicate).length;
}
