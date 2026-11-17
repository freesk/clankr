import { describe, expect, it } from "vitest";
import type { SuiteResult } from "../runner/run-suite.ts";
import type { RunResult } from "../runner/run-task.ts";
import type { ToolCallRecord } from "../runner/transcript.ts";
import { chartRenderedWithinLimit, computeMetrics, median } from "./compute.ts";

function call(tool: string, outcome: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return { callId: "c", tool, finished: true, validity: "valid", ...outcome };
}

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runIndex: 0,
    status: "passed",
    failures: [],
    missingRequirements: [],
    toolCalls: [],
    turnEnds: [],
    tokensSent: 0,
    contextOverflow: false,
    durationMs: 1,
    ...overrides,
  };
}

function suite(
  tasks: { chart?: boolean; status?: "passed" | "failed" | "skipped"; runs: RunResult[] }[],
): SuiteResult {
  return {
    model: "m",
    startedAt: "",
    finishedAt: "",
    runsPerTask: 3,
    minimumPassingRuns: 2,
    tasks: tasks.map((task, index) => ({
      task: { id: `t${index}`, scenario: "S1", title: "", chart: task.chart ?? false },
      status: task.status ?? "passed",
      runs: task.runs,
    })),
  };
}

describe("computeMetrics", () => {
  it("separates strict first-attempt validity from valid-or-repaired, and counts calls without validity", () => {
    const metrics = computeMetrics(
      suite([
        {
          runs: [
            run({
              toolCalls: [
                call("read_file"),
                call("read_file", { validity: "repaired" }),
                call("read_file", { validity: "invalid", error: "bad" }),
                call("read_file", { validity: undefined }),
              ],
            }),
          ],
        },
      ]),
    );
    expect(metrics.firstAttemptValidRate).toEqual({ numerator: 1, denominator: 3, rate: 1 / 3 });
    expect(metrics.validOrRepairedRate.numerator).toBe(2);
    expect(metrics.callsWithoutValidity).toBe(1);
  });

  it("counts chart runs that rendered within 3 attempts", () => {
    const failed = call("make_chart", { error: "spec invalid" });
    const rendered = call("make_chart");
    const metrics = computeMetrics(
      suite([
        {
          chart: true,
          runs: [
            run({ toolCalls: [failed, failed, rendered] }),
            run({ toolCalls: [failed, failed, failed, rendered] }),
            run({ toolCalls: [] }),
          ],
        },
        { chart: false, runs: [run({ toolCalls: [failed] })] },
      ]),
    );
    expect(metrics.chartWithinAttemptsRate).toEqual({ numerator: 1, denominator: 3, rate: 1 / 3 });
  });

  it("does not count a make_chart call left open by a cancelled run", () => {
    expect(
      chartRenderedWithinLimit(run({ toolCalls: [call("make_chart", { finished: false })] })),
    ).toBe(false);
  });

  it("takes the median tokens over passed runs only, and leaves skipped tasks out", () => {
    const metrics = computeMetrics(
      suite([
        {
          runs: [
            run({ tokensSent: 100 }),
            run({ tokensSent: 300 }),
            run({ status: "failed", tokensSent: 9_999 }),
          ],
        },
        { status: "skipped", runs: [run({ status: "skipped" })] },
      ]),
    );
    expect(metrics.medianTokensPerCompletedTask).toBe(200);
    expect(metrics.skippedTasks).toBe(1);
    expect(metrics.runPassRate.denominator).toBe(3);
  });

  it("reports outbound connections only when the network test supplied them", () => {
    expect(computeMetrics(suite([])).outboundConnections).toBeUndefined();
    expect(computeMetrics(suite([]), 2).outboundConnections).toBe(2);
  });
});

describe("median", () => {
  it("handles odd, even, and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});
