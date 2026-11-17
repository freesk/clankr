import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderPdf } from "../fixtures/generators/pdf.ts";
import { materializeFixtures } from "../fixtures/materialize.ts";
import type { Assertion } from "../tasks/schema.ts";
import { plannedToolNames } from "../tasks/tool-inventory.ts";
import { evaluateAssertions, numbersIn } from "./assertions.ts";
import { findShellLikeTools, isShellLikeToolName } from "./no-shell-tool.ts";
import type { AssertionContext } from "./types.ts";

describe("PERM-6: no shell tool", () => {
  it("passes for the v1 tool inventory", () => {
    expect(findShellLikeTools(plannedToolNames)).toEqual([]);
  });

  it("catches a shell-like tool added to the registry, however it is spelled", () => {
    const names = [
      ...plannedToolNames,
      "run_shell",
      "bash",
      "execCommand",
      "Terminal",
      "spawn-process",
    ];
    expect(findShellLikeTools(names)).toEqual([
      "run_shell",
      "bash",
      "execCommand",
      "Terminal",
      "spawn-process",
    ]);
  });

  it("does not flag tools that only share a prefix with a shell word", () => {
    for (const name of ["run_js", "share_link", "commander_notes", "execution_plan", "show_dir"]) {
      expect(isShellLikeToolName(name), name).toBe(false);
    }
  });
});

describe("numbersIn", () => {
  it("reads numbers as people write them", () => {
    expect(numbersIn("Total $42.50, 1,812,000 in all, 750 000 units, -3 left")).toEqual([
      42.5, 1_812_000, 750_000, -3,
    ]);
  });
});

describe("evaluateAssertions", () => {
  let directory: string;
  let context: AssertionContext;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "clankr-evals-checks-"));
    const fixtureSnapshot = await materializeFixtures(directory, [
      { kind: "text", path: "kept.txt", content: "original" },
      { kind: "text", path: "changed.txt", content: "original" },
      { kind: "generated", generator: "pdf", path: "input.pdf", options: { lines: ["fixture"] } },
    ]);
    await writeFile(join(directory, "changed.txt"), "edited");
    context = {
      workingDirectory: directory,
      fixtureSnapshot,
      finalAnswer: "The total is 1,234. Done.",
      toolCalls: [{ callId: "1", tool: "read_file", finished: true, validity: "valid" }],
      activeModelKey: "a/model",
    };
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("checks files, the answer, and tool calls", async () => {
    const failures = await evaluateAssertions(
      [
        { kind: "file-unchanged", path: "kept.txt" },
        { kind: "file-unchanged", path: "changed.txt" },
        { kind: "answer-number", value: 1234, tolerance: 0 },
        { kind: "answer-contains", anyOf: ["DONE"] },
        { kind: "tool-called", tool: "read_file" },
        { kind: "tool-not-called", tool: "read_file" },
        { kind: "active-model", key: "a/model" },
      ],
      context,
    );
    expect(failures).toEqual([
      "file-unchanged: changed.txt was modified",
      "tool-not-called: read_file was called",
    ]);
  });

  it("does not count a fixture PDF as a created one", async () => {
    expect(await evaluateAssertions([{ kind: "pdf-created", directory: "." }], context)).toEqual([
      "pdf-created: no new PDF under .",
    ]);
    await writeFile(join(directory, "chart.pdf"), renderPdf({ lines: ["chart"] }));
    expect(await evaluateAssertions([{ kind: "pdf-created", directory: "." }], context)).toEqual(
      [],
    );
  });

  it("finds a saved Vega-Lite spec and checks its mark, fields, and stacking", async () => {
    await mkdir(join(directory, "out"));
    const spec = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: { type: "bar" },
      encoding: {
        x: { field: "Month", type: "ordinal" },
        y: { field: "headcount", aggregate: "sum" },
        color: { field: "department" },
      },
    };
    await writeFile(join(directory, "out", "chart.vl.json"), JSON.stringify(spec));

    const stackedBar: Assertion = {
      kind: "chart-spec",
      directory: "out",
      mark: "bar",
      fields: ["month", "department"],
      stacked: true,
    };
    expect(await evaluateAssertions([stackedBar], context)).toEqual([]);
    expect(await evaluateAssertions([{ ...stackedBar, mark: "line" }], context)).toEqual([
      "chart-spec: no saved spec matches: mark is bar, expected line",
    ]);

    spec.encoding.y = { ...spec.encoding.y, stack: null } as typeof spec.encoding.y;
    await writeFile(join(directory, "out", "chart.vl.json"), JSON.stringify(spec));
    expect(await evaluateAssertions([stackedBar], context)).toEqual([
      "chart-spec: no saved spec matches: the chart is not stacked",
    ]);
  });
});
