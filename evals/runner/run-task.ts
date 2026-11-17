// One run of one golden task: a clean working directory and `~/.clankr/`, the
// fixtures, a fresh harness, the steps, then the assertions.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemporaryClankrPaths } from "../../src/testing/index.ts";
import { evaluateAssertions } from "../checks/assertions.ts";
import { assertNoShellTool } from "../checks/no-shell-tool.ts";
import { type FixtureSnapshot, materializeFixtures } from "../fixtures/materialize.ts";
import type { GoldenTask, Step } from "../tasks/schema.ts";
import { type EvalHarness, type HarnessFactory, harnessCapabilities } from "./harness.ts";
import { type ToolCallRecord, TranscriptRecorder, type TurnEndRecord } from "./transcript.ts";
import { isContextOverflowMessage } from "./usage-recording-lm-client.ts";

export interface RunOptions {
  /** A run that takes longer is cancelled and fails. */
  timeoutMs: number;
  /** Where large generated fixtures are cached between runs. */
  fixtureCacheDirectory?: string;
}

export type RunStatus = "passed" | "failed" | "skipped";

export interface RunResult {
  runIndex: number;
  status: RunStatus;
  /** Why the run failed; empty when it passed. */
  failures: string[];
  /** Tools and commands the task needs that the harness does not have. */
  missingRequirements: string[];
  toolCalls: ToolCallRecord[];
  turnEnds: TurnEndRecord[];
  tokensSent: number;
  contextOverflow: boolean;
  durationMs: number;
}

export async function runTaskOnce(
  task: GoldenTask,
  createHarness: HarnessFactory,
  runIndex: number,
  options: RunOptions,
): Promise<RunResult> {
  const startedAt = performance.now();
  const workingDirectory = await mkdtemp(join(tmpdir(), `clankr-eval-${task.id}-`));
  const clankr = await createTemporaryClankrPaths(`eval-${task.id}-${runIndex}`);
  let harness: EvalHarness | undefined;
  try {
    const fixtureSnapshot = await materializeFixtures(workingDirectory, task.fixtures, {
      cacheDirectory: options.fixtureCacheDirectory,
    });
    harness = await createHarness({ workingDirectory, clankrPaths: clankr.paths });
    // A shell tool invalidates every result, so it stops the suite rather than failing one task.
    assertNoShellTool(harness.toolNames());
    const capabilities = harnessCapabilities(harness);
    const missing = task.requires.filter((requirement) => !capabilities.has(requirement));
    if (missing.length > 0) return skippedRun(runIndex, missing, startedAt);
    return await executeRun(
      task,
      harness,
      { workingDirectory, fixtureSnapshot },
      runIndex,
      options,
      startedAt,
    );
  } finally {
    await harness?.close();
    await rm(workingDirectory, { recursive: true, force: true });
    await clankr.cleanup();
  }
}

interface RunWorkspace {
  workingDirectory: string;
  fixtureSnapshot: FixtureSnapshot;
}

async function executeRun(
  task: GoldenTask,
  harness: EvalHarness,
  workspace: RunWorkspace,
  runIndex: number,
  options: RunOptions,
  startedAt: number,
): Promise<RunResult> {
  const recorder = new TranscriptRecorder();
  const signal = AbortSignal.timeout(options.timeoutMs);
  const failures: string[] = [];
  try {
    for (const step of task.steps) await runStep(step, harness, recorder, signal);
  } catch (error) {
    failures.push(
      signal.aborted
        ? `run timed out after ${options.timeoutMs} ms`
        : `run error: ${messageOf(error)}`,
    );
  }
  failures.push(...turnEndFailures(recorder.turnEnds));
  failures.push(
    ...(await evaluateAssertions(task.assertions, {
      ...workspace,
      finalAnswer: recorder.finalAnswer,
      toolCalls: recorder.toolCalls,
      activeModelKey: harness.activeModelKey(),
    })),
  );
  const tally = harness.tokenTally();
  return {
    runIndex,
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    missingRequirements: [],
    toolCalls: recorder.toolCalls,
    turnEnds: recorder.turnEnds,
    tokensSent: tally.tokensSent,
    contextOverflow: tally.contextOverflows > 0 || recorder.turnEnds.some(endedInOverflow),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function runStep(
  step: Step,
  harness: EvalHarness,
  recorder: TranscriptRecorder,
  signal: AbortSignal,
): Promise<void> {
  if ("command" in step) {
    await harness.runCommand(step.command, signal);
    return;
  }
  for await (const event of harness.runTurn(step.prompt, signal)) recorder.record(event);
}

/** A turn that errored or was cancelled did not complete the task, whatever the files say. */
function turnEndFailures(turnEnds: TurnEndRecord[]): string[] {
  return turnEnds
    .filter((end) => end.reason === "error" || end.reason === "cancelled")
    .map((end) => `turn ended with ${end.reason}${end.message ? `: ${end.message}` : ""}`);
}

function endedInOverflow(end: TurnEndRecord): boolean {
  return end.reason === "error" && isContextOverflowMessage(end.message ?? "");
}

function skippedRun(runIndex: number, missing: string[], startedAt: number): RunResult {
  return {
    runIndex,
    status: "skipped",
    failures: [],
    missingRequirements: missing,
    toolCalls: [],
    turnEnds: [],
    tokensSent: 0,
    contextOverflow: false,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
