// Choosing the output format end to end (D85), with every real part except the model: the
// `--format` flag and the one-shot error through `clankr -p`, and the REPL's question and
// `/format` through the real controller. The file written is an .xlsx or .docx from export_table.

import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Harness } from "../../src/cli/harness.ts";
import { ReplController } from "../../src/cli/repl/controller.ts";
import { ReplApprovalPrompter } from "../../src/cli/repl/repl-approval-prompter.ts";
import type { KeyPress, ReplState } from "../../src/cli/repl/repl-state.ts";
import type { ChatRequest } from "../../src/contracts/index.ts";
import { respond, type ScriptedResponse } from "../../src/testing/index.ts";
import { createIntegrationKit, type IntegrationKit, lastToolResult } from "./integration-kit.ts";

let kit: IntegrationKit | undefined;
let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  await kit?.cleanup();
  harness = undefined;
  kit = undefined;
});

const salesCsv = "region,units\nnorth,10\nsouth,20\nnorth,5\n";
const totalsSql = "SELECT region, SUM(units) AS units FROM sales GROUP BY region ORDER BY region";

/** The export call the "model" writes, using the handle query_sql just returned. */
function exportCall(extra: Record<string, unknown> = {}) {
  return (request: ChatRequest) => {
    const handle = /Full result: (r\d+)/.exec(lastToolResult(request.messages))?.[1] ?? "missing";
    return respond.toolCall("export_table", { handle, title: "Units by region", ...extra });
  };
}

function exportTurn(extra: Record<string, unknown> = {}): ScriptedResponse[] {
  return [
    respond.toolCall("inspect_data", { path: "sales.csv" }),
    respond.toolCall("query_sql", { sql: totalsSql }),
    exportCall(extra),
    respond.text("Done."),
  ];
}

async function kitWithSales(options: Parameters<typeof createIntegrationKit>[0]) {
  const created = await createIntegrationKit(options);
  await writeFile(join(created.workingDirectory, "sales.csv"), salesCsv);
  return created;
}

async function exportedFiles(current: IntegrationKit): Promise<string[]> {
  return (await readdir(current.workingDirectory)).filter((name) => name !== "sales.csv").sort();
}

const oneShotFlags = ["--allow-data", "--permission-mode", "auto-edit"];

describe("output format in one-shot mode", () => {
  it("fails with the formats and --format when nothing names a format", async () => {
    kit = await kitWithSales({ responses: exportTurn() });
    const result = await kit.run(["-p", "Save units per region from sales.csv", ...oneShotFlags]);

    const toolResult = lastToolResult(kit.lm.requests.at(-1)?.messages ?? []);
    expect(toolResult).toContain("No output format was chosen for this table");
    expect(toolResult).toContain("xlsx, docx, pdf, csv");
    expect(toolResult).toContain("--format <name>");
    expect(result.stderr).toMatch(/export_table.*failed/);
    expect(await exportedFiles(kit)).toEqual([]);
  });

  it("saves in the --format format", async () => {
    kit = await kitWithSales({ responses: exportTurn() });
    const result = await kit.run([
      "-p",
      "Save units per region from sales.csv",
      ...oneShotFlags,
      "--format",
      "xlsx",
    ]);
    expect(result.exitCode).toBe(0);
    expect(lastToolResult(kit.lm.requests.at(-1)?.messages ?? [])).toContain("Saved table:");
    expect(await exportedFiles(kit)).toEqual(["units-by-region.xlsx"]);
  });

  it("uses the format the user's message names, over --format", async () => {
    kit = await kitWithSales({ responses: exportTurn({ format: "docx" }) });
    await kit.run([
      "-p",
      "Save units per region from sales.csv as a Word document",
      ...oneShotFlags,
      "--format",
      "xlsx",
    ]);
    expect(await exportedFiles(kit)).toEqual(["units-by-region.docx"]);
  });

  it("does not let a format the model guessed stand in for the user's choice (D86)", async () => {
    kit = await kitWithSales({ responses: exportTurn({ format: "docx" }) });
    await kit.run(["-p", "Save units per region from sales.csv", ...oneShotFlags]);
    const toolResult = lastToolResult(kit.lm.requests.at(-1)?.messages ?? []);
    expect(toolResult).toContain('"docx" was not used: the user\'s message does not name it.');
    expect(await exportedFiles(kit)).toEqual([]);
  });

  it("uses the config default when neither the request nor a flag names a format", async () => {
    kit = await kitWithSales({
      responses: exportTurn(),
      config: { output: { defaultFormat: "csv" } },
    });
    await kit.run(["-p", "Save units per region from sales.csv", ...oneShotFlags]);
    expect(await exportedFiles(kit)).toEqual(["units-by-region.csv"]);
  });

  it("treats export_table as a write: --allow-data alone does not cover it", async () => {
    kit = await kitWithSales({ responses: exportTurn() });
    const result = await kit.run([
      "-p",
      "Save units per region from sales.csv",
      "--allow-data",
      "--format",
      "xlsx",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/denied export_table.*--permission-mode auto-edit/);
    expect(await exportedFiles(kit)).toEqual([]);
  });

  it("rejects an unknown --format as a usage error", async () => {
    kit = await createIntegrationKit();
    const result = await kit.run(["-p", "hi", "--format", "pptx"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--format must be one of xlsx, docx, pdf, png, svg, csv.");
  });
});

const noKey: KeyPress = {
  ctrl: false,
  meta: false,
  return: false,
  escape: false,
  backspace: false,
  delete: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  tab: false,
};

function waitFor(controller: ReplController, predicate: (state: ReplState) => boolean) {
  return new Promise<ReplState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitFor timed out")), 10_000);
    const check = () => {
      const state = controller.getState();
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    };
    const unsubscribe = controller.subscribe(check);
    check();
  });
}

/** The REPL as start-repl.ts wires it: approval prompts and the picker go to the controller. */
async function openRepl(current: IntegrationKit, outputFormat?: "pdf") {
  const config = await current.composition.loadConfig({
    flags: { permissionMode: "auto-edit" },
    workingDirectory: current.workingDirectory,
    environment: {},
  });
  const prompter = new ReplApprovalPrompter();
  let choose: ReplController["choose"] = async () => undefined;
  const opened = await current.composition.openHarness({
    config,
    approvalPrompter: prompter,
    ...(outputFormat ? { outputFormat } : {}),
    choose: (prompt, options) => choose(prompt, options),
    ephemeral: true,
    resume: false,
    workingDirectory: current.workingDirectory,
  });
  const controller = new ReplController({
    harness: opened,
    workingDirectory: current.workingDirectory,
  });
  prompter.connect(controller);
  choose = (prompt, options) => controller.choose(prompt, options);
  return { opened, controller };
}

/**
 * Types a prompt and grants the data file for the session when query_sql asks. The turn is
 * returned inside an object, so awaiting this does not wait for the turn itself to end.
 */
async function startTurn(controller: ReplController, text: string) {
  const finished = controller.submit(text);
  await waitFor(controller, (state) => state.approval !== undefined);
  controller.handleKey("a", noKey);
  return { finished };
}

describe("output format in the REPL", () => {
  it("asks before saving, and keeps the pick for the session when the user says so", async () => {
    kit = await kitWithSales({ responses: [...exportTurn(), ...exportTurn()] });
    const { opened, controller } = await openRepl(kit);
    harness = opened;

    const first = await startTurn(controller, "Save units per region from sales.csv");
    const formatQuestion = await waitFor(controller, (state) => state.choice !== undefined);
    expect(formatQuestion.choice?.prompt).toBe("Save the table as which format?");
    expect(formatQuestion.choice?.options.map((option) => option.value)).toEqual([
      "xlsx",
      "docx",
      "pdf",
      "csv",
    ]);
    // Nothing is written while the question is open.
    expect(await exportedFiles(kit)).toEqual([]);
    controller.handleKey("", { ...noKey, downArrow: true });
    controller.handleKey("", { ...noKey, return: true });

    const scopeQuestion = await waitFor(
      controller,
      (state) => state.choice?.prompt === "Use docx for",
    );
    expect(scopeQuestion.choice?.options.map((option) => option.label)).toEqual([
      "This table only",
      "Every file in this session (change it with /format)",
    ]);
    controller.handleKey("", { ...noKey, downArrow: true });
    controller.handleKey("", { ...noKey, return: true });
    await first.finished;

    expect(await exportedFiles(kit)).toEqual(["units-by-region.docx"]);
    expect(opened.session().outputFormat).toBe("docx");

    // The kept pick is the session's format now: the next export does not ask.
    await controller.submit("And once more");
    expect(controller.getState().choice).toBeUndefined();
    expect(await exportedFiles(kit)).toEqual(["units-by-region-2.docx", "units-by-region.docx"]);
  });

  it("uses a pick for one file only unless told to keep it, and saves nothing on Esc", async () => {
    kit = await kitWithSales({ responses: [...exportTurn(), ...exportTurn()] });
    const { opened, controller } = await openRepl(kit);
    harness = opened;

    const first = await startTurn(controller, "Save units per region from sales.csv");
    await waitFor(controller, (state) => state.choice !== undefined);
    controller.handleKey("", { ...noKey, return: true });
    await waitFor(controller, (state) => state.choice?.prompt === "Use xlsx for");
    controller.handleKey("", { ...noKey, return: true });
    await first.finished;
    expect(await exportedFiles(kit)).toEqual(["units-by-region.xlsx"]);
    expect(opened.session().outputFormat).toBeUndefined();

    const second = controller.submit("And once more");
    await waitFor(controller, (state) => state.choice !== undefined);
    controller.handleKey("", { ...noKey, escape: true });
    await second;
    expect(await exportedFiles(kit)).toEqual(["units-by-region.xlsx"]);
    const toolResult = lastToolResult(kit.lm.requests.at(-1)?.messages ?? []);
    expect(toolResult).toContain("closed the format question without choosing");
  });

  it("follows /format, shows it, and keeps it across /clear", async () => {
    kit = await kitWithSales({ responses: [...exportTurn(), ...exportTurn()] });
    const { opened, controller } = await openRepl(kit, "pdf");
    harness = opened;
    expect(opened.session().outputFormat).toBe("pdf");

    await controller.submit("/format csv");
    expect(controller.getState().entries.at(-1)?.text).toContain("saved as csv in this session");
    const turn = await startTurn(controller, "Save units per region from sales.csv");
    await turn.finished;
    expect(controller.getState().choice).toBeUndefined();
    expect(await exportedFiles(kit)).toEqual(["units-by-region.csv"]);

    await controller.submit("/clear");
    expect(opened.session().outputFormat).toBe("csv");
    await controller.submit("/format ask");
    expect(opened.session().outputFormat).toBeUndefined();
  });
});
