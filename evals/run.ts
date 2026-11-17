// `npm run evals`: runs the golden suite against LM Studio and saves a report
// in evals/reports/. Run by hand on the reference machine before a release (D33).
//
//   npm run evals -- --dry-run                 validate tasks and build their fixtures
//   npm run evals -- --model <key> --runs 3    a real run (wave 2)
//   npm run evals -- --only <id,id> --scenario S8 --outbound 0

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { materializeFixtures } from "./fixtures/materialize.ts";
import { computeMetrics } from "./metrics/compute.ts";
import { targetModel, writeReport } from "./metrics/report.ts";
import { createRealHarnessFactory } from "./runner/real-harness.ts";
import { defaultRunsPerTask, runSuite } from "./runner/run-suite.ts";
import { loadGoldenTasks } from "./tasks/load.ts";
import type { GoldenTask } from "./tasks/schema.ts";

const reportDirectory = fileURLToPath(new URL("./reports/", import.meta.url));
const defaultTimeoutMs = 10 * 60 * 1000;

const { values: flags } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    model: { type: "string", default: targetModel },
    runs: { type: "string", default: String(defaultRunsPerTask) },
    only: { type: "string" },
    scenario: { type: "string" },
    "timeout-ms": { type: "string", default: String(defaultTimeoutMs) },
    /** The outbound-connection count from the network test, to include in the report. */
    outbound: { type: "string" },
  },
});

function selectTasks(tasks: GoldenTask[]): GoldenTask[] {
  const onlyIds = flags.only?.split(",").map((id) => id.trim());
  return tasks.filter(
    (task) =>
      (!onlyIds || onlyIds.includes(task.id)) &&
      (!flags.scenario || task.scenario === flags.scenario),
  );
}

/** Builds every task's fixtures once, so a broken generator or task shows up without a model. */
async function dryRun(tasks: GoldenTask[]): Promise<void> {
  for (const task of tasks) {
    const directory = await mkdtemp(join(tmpdir(), "clankr-eval-dry-"));
    try {
      const snapshot = await materializeFixtures(directory, task.fixtures);
      console.log(
        `ok  ${task.id.padEnd(36)} ${task.scenario.padEnd(3)} fixtures ${snapshot.size}  requires ${task.requires.join(", ")}`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  console.log(`\n${tasks.length} tasks valid.`);
}

async function realRun(tasks: GoldenTask[]): Promise<void> {
  const suite = await runSuite(tasks, createRealHarnessFactory(), {
    model: flags.model,
    runsPerTask: Number(flags.runs),
    timeoutMs: Number(flags["timeout-ms"]),
    onRunFinished: (task, run) =>
      console.log(
        `${run.status.padEnd(7)} ${task.id} run ${run.runIndex + 1}${run.failures.length ? `: ${run.failures.join("; ")}` : ""}`,
      ),
  });
  const metrics = computeMetrics(
    suite,
    flags.outbound === undefined ? undefined : Number(flags.outbound),
  );
  const written = await writeReport(reportDirectory, suite, metrics);
  console.log(`\nReport: ${written.markdownPath}`);
}

const tasks = selectTasks(await loadGoldenTasks());
if (flags["dry-run"]) await dryRun(tasks);
else await realRun(tasks);
