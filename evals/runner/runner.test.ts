// The runner end to end, driven by the scripted harness.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatEvent } from "../../src/contracts/index.ts";
import { respond } from "../../src/testing/index.ts";
import { computeMetrics } from "../metrics/compute.ts";
import { writeReport } from "../metrics/report.ts";
import { type GoldenTask, taskSchema } from "../tasks/schema.ts";
import { createScriptedHarnessFactory } from "../testing/scripted-harness.ts";
import { toyNoOp, toyWriteFile } from "../testing/toy-tools.ts";
import { runSuite } from "./run-suite.ts";

const writeHelloTask: GoldenTask = taskSchema.parse({
  id: "write-hello",
  scenario: "S3",
  title: "Write a greeting",
  requires: ["write_file"],
  steps: [{ prompt: "Write hello.txt containing hello" }],
  assertions: [
    { kind: "file-contains", path: "hello.txt", text: "hello" },
    { kind: "answer-contains", anyOf: ["done"] },
  ],
});

/** A successful run: one write_file call, then a final answer. Reports 100 prompt tokens per request. */
function successfulRun(): ChatEvent[][] {
  return [
    withPromptTokens(respond.toolCall("write_file", { path: "hello.txt", content: "hello" }), 100),
    withPromptTokens(respond.text("Done."), 150),
  ];
}

function failingRun(): ChatEvent[][] {
  return [respond.text("I would rather not.")];
}

function withPromptTokens(events: ChatEvent[], promptTokens: number): ChatEvent[] {
  return events.map((event) =>
    event.type === "usage"
      ? { type: "usage", usage: { promptTokens, completionTokens: 1 } }
      : event,
  );
}

const suiteOptions = { model: "test/model-12b", runsPerTask: 3, timeoutMs: 5_000 };

let reportDirectory: string;

beforeEach(async () => {
  reportDirectory = await mkdtemp(join(tmpdir(), "clankr-evals-report-"));
});

afterEach(async () => {
  await rm(reportDirectory, { recursive: true, force: true });
});

describe("runSuite", () => {
  it("runs a trivial task end to end and writes a report", async () => {
    const factory = createScriptedHarnessFactory({
      responsesForRun: successfulRun,
      tools: [toyWriteFile],
    });
    const suite = await runSuite([writeHelloTask], factory, suiteOptions);

    expect(suite.tasks[0]?.status).toBe("passed");
    expect(suite.tasks[0]?.runs.map((run) => run.status)).toEqual(["passed", "passed", "passed"]);
    expect(suite.tasks[0]?.runs[0]?.tokensSent).toBe(250);

    const metrics = computeMetrics(suite, 0);
    const written = await writeReport(reportDirectory, suite, metrics);
    const markdown = await readFile(written.markdownPath, "utf8");
    expect(markdown).toContain("| Golden task pass rate | 100% (1 / 1) | ≥ 80% | yes |");
    expect(markdown).toContain(
      "| Tool calls valid on the first attempt | 100% (3 / 3) | ≥ 95% | yes |",
    );
    expect(markdown).toContain("| Median tokens sent per completed task | 250 |");
    expect(markdown).toContain("**Not the target model.**");
    const json = JSON.parse(await readFile(written.jsonPath, "utf8"));
    expect(json.metrics.taskPassRate.rate).toBe(1);
  });

  it("reports a deliberately failing task as failing, with the reason", async () => {
    const factory = createScriptedHarnessFactory({
      responsesForRun: failingRun,
      tools: [toyWriteFile],
    });
    const suite = await runSuite([writeHelloTask], factory, suiteOptions);

    expect(suite.tasks[0]?.status).toBe("failed");
    const failures = suite.tasks[0]?.runs[0]?.failures ?? [];
    expect(failures).toContain("file-contains: hello.txt does not exist");
    expect(failures).toContain("answer-contains: the answer mentions none of: done");

    const markdown = await readFile(
      (await writeReport(reportDirectory, suite, computeMetrics(suite))).markdownPath,
      "utf8",
    );
    expect(markdown).toContain("| write-hello | S3 | failed | 0 / 3 |");
    expect(markdown).toContain("- **write-hello** run 1: file-contains: hello.txt does not exist");
  });

  it("passes a task on 2 of 3 runs and reports the per-run rate", async () => {
    const factory = createScriptedHarnessFactory({
      responsesForRun: (runNumber) => (runNumber === 1 ? failingRun() : successfulRun()),
      tools: [toyWriteFile],
    });
    const suite = await runSuite([writeHelloTask], factory, suiteOptions);
    const metrics = computeMetrics(suite);

    expect(suite.tasks[0]?.status).toBe("passed");
    expect(metrics.runPassRate).toEqual({ numerator: 2, denominator: 3, rate: 2 / 3 });
  });

  it("fails a task that passes only 1 of 3 runs", async () => {
    const factory = createScriptedHarnessFactory({
      responsesForRun: (runNumber) => (runNumber === 0 ? successfulRun() : failingRun()),
      tools: [toyWriteFile],
    });
    const suite = await runSuite([writeHelloTask], factory, suiteOptions);
    expect(suite.tasks[0]?.status).toBe("failed");
  });

  it("skips a task whose tools do not exist yet, once", async () => {
    const factory = createScriptedHarnessFactory({ responsesForRun: successfulRun, tools: [] });
    const suite = await runSuite([writeHelloTask], factory, suiteOptions);

    expect(suite.tasks[0]?.status).toBe("skipped");
    expect(suite.tasks[0]?.runs).toHaveLength(1);
    expect(suite.tasks[0]?.runs[0]?.missingRequirements).toEqual(["write_file"]);
    expect(computeMetrics(suite).taskPassRate.rate).toBeUndefined();
  });

  it("stops the suite when the registry has a shell tool (PERM-6)", async () => {
    const factory = createScriptedHarnessFactory({
      responsesForRun: successfulRun,
      tools: [toyWriteFile, toyNoOp("run_shell")],
    });
    await expect(runSuite([writeHelloTask], factory, suiteOptions)).rejects.toThrow(
      "PERM-6 violated: the registry contains shell-like tools: run_shell",
    );
  });

  it("runs slash command steps and checks the active model", async () => {
    const switchTask = taskSchema.parse({
      id: "switch",
      scenario: "S10",
      title: "Switch",
      requires: ["command:model"],
      steps: [{ command: "/model other/model" }, { prompt: "hi" }],
      assertions: [{ kind: "active-model", key: "other/model" }],
    });
    const factory = createScriptedHarnessFactory({
      responsesForRun: () => [respond.text("hello")],
      commands: ["model"],
    });
    const suite = await runSuite([switchTask], factory, { ...suiteOptions, runsPerTask: 1 });
    expect(suite.tasks[0]?.status).toBe("passed");
  });

  it("fails a run whose model call errors, and counts a context overflow", async () => {
    const factory = createScriptedHarnessFactory({
      responsesForRun: () => [
        () => {
          throw new Error("The prompt exceeds the context length of the loaded model");
        },
      ],
      tools: [toyWriteFile],
    });
    const suite = await runSuite([writeHelloTask], factory, { ...suiteOptions, runsPerTask: 1 });
    const run = suite.tasks[0]?.runs[0];

    expect(run?.status).toBe("failed");
    expect(run?.failures[0]).toContain("run error: The prompt exceeds the context length");
    expect(run?.contextOverflow).toBe(true);
    expect(computeMetrics(suite).contextOverflowRuns).toBe(1);
  });
});
