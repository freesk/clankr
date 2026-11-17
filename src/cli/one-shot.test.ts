import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../contracts/index.ts";
import { respond, ScriptedLmClient } from "../testing/index.ts";
import { exitCodes } from "./exit-codes.ts";
import { oneShotDenialFeedback } from "./one-shot-prompter.ts";
import { runCli } from "./run-cli.ts";
import {
  createFakeComposition,
  createFakeHarness,
  createTestEnvironment,
  type FakeTurn,
  hangingTurn,
  scriptedLmTurn,
  textTurn,
} from "./testing/fake-harness.ts";

function compositionWithTurn(turn: FakeTurn) {
  return createFakeComposition({
    harness: (options) =>
      createFakeHarness({
        turn,
        config: options.config,
        approvalPrompter: options.approvalPrompter,
      }),
  });
}

function endingWith(reason: "error" | "limit", message: string): FakeTurn {
  return async function* () {
    yield { type: "turn-end", reason, message };
  };
}

/** A write tool behind a gate that asks unless the mode is auto-edit, as permissions will. */
const writeFileTurn: FakeTurn = async function* (_input, _signal, context) {
  yield { type: "tool-start", callId: "c1", tool: "write_file", keyArgument: "notes.md" };
  let error: string | undefined;
  if (context.session.permissionMode !== "auto-edit") {
    const answer = await context.approvalPrompter.ask({
      tool: { name: "write_file", permission: "write" },
      preview: { summary: "Create notes.md (3 lines)", targetPaths: ["/work/notes.md"] },
      reason: "write tools ask in ask mode",
    });
    if (answer.kind === "deny") error = `Denied: ${answer.feedback ?? ""}`;
  }
  const end: AgentEvent = { type: "tool-end", callId: "c1", resultTokens: 12, durationMs: 5 };
  yield error ? { ...end, error } : end;
  yield { type: "text", delta: error ? "I could not write the file." : "Wrote notes.md." };
  yield { type: "turn-end", reason: "done" };
};

describe("one-shot mode", () => {
  it("prints the result and exits 0", async () => {
    const lm = new ScriptedLmClient([respond.toolCall("find_files", { pattern: "*.pdf" })]);
    lm.enqueue(respond.text("Found 3 PDFs."));
    const environment = createTestEnvironment({
      argv: ["-p", "find pdfs"],
      composition: compositionWithTurn(scriptedLmTurn(lm)),
    });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(environment.output()).toBe("Found 3 PDFs.\n");
    expect(environment.errors()).toBe("● find_files *.pdf · 312 tokens · 420 ms\n");
  });

  it("exits 1 when the turn fails or hits a limit, with the message on stderr", async () => {
    for (const reason of ["error", "limit"] as const) {
      const environment = createTestEnvironment({
        argv: ["-p", "x"],
        composition: compositionWithTurn(endingWith(reason, `stopped by ${reason}`)),
      });
      expect(await runCli(environment)).toBe(exitCodes.failed);
      expect(environment.errors()).toContain(`clankr: stopped by ${reason}`);
    }
  });

  it("exits 2 on a usage error", async () => {
    const environment = createTestEnvironment({
      argv: ["--permission-mode", "nope"],
      composition: createFakeComposition(),
    });
    expect(await runCli(environment)).toBe(exitCodes.usage);
    expect(environment.errors()).toMatch(/Usage:/);
  });

  it("rejects --allow-data outside one-shot mode and passes it through in one-shot (D74)", async () => {
    const repl = createTestEnvironment({
      argv: ["--allow-data"],
      stdinMode: "terminal",
      composition: createFakeComposition(),
    });
    expect(await runCli(repl)).toBe(exitCodes.usage);
    expect(repl.errors()).toMatch(/--allow-data applies to one-shot mode/);

    const composition = createFakeComposition();
    await runCli(createTestEnvironment({ argv: ["-p", "x", "--allow-data"], composition }));
    expect(composition.openedWith[0]?.allowData).toBe(true);
  });

  it("exits 130 when Ctrl+C cancels the turn, and a second press forces the exit", async () => {
    const environment = createTestEnvironment({
      argv: ["-p", "x"],
      composition: compositionWithTurn(async function* (_input, signal) {
        yield { type: "text", delta: "partial" };
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
        yield { type: "turn-end", reason: "cancelled" };
      }),
    });
    const running = runCli(environment);
    await new Promise((resolve) => setTimeout(resolve, 10));
    environment.interrupt();
    expect(await running).toBe(exitCodes.cancelled);
    expect(environment.errors()).toContain("Cancelled.");

    const stuck = createTestEnvironment({
      argv: ["-p", "x"],
      composition: compositionWithTurn(hangingTurn()),
    });
    void runCli(stuck);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stuck.interrupt();
    stuck.interrupt();
    expect(stuck.forcedExitCode).toBe(exitCodes.cancelled);
  });

  it("passes piped stdin to the prompt", async () => {
    const composition = compositionWithTurn(textTurn("done"));
    const environment = createTestEnvironment({
      argv: ["-p", "summarize this"],
      composition,
      stdinText: "line one\nline two\n",
    });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(composition.opened[0]?.inputs[0]?.text).toBe("summarize this\n\nline one\nline two");
  });

  it("uses piped stdin alone as the prompt", async () => {
    const composition = compositionWithTurn(textTurn("done"));
    const environment = createTestEnvironment({ argv: [], composition, stdinText: "hello" });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(composition.opened[0]?.inputs[0]?.text).toBe("hello");
  });

  it("stores large piped stdin and sends a preview with a handle", async () => {
    const composition = compositionWithTurn(textTurn("done"));
    const bigInput = Array.from({ length: 2_000 }, (_, index) => `row ${index}`).join("\n");
    const environment = createTestEnvironment({
      argv: ["-p", "count"],
      composition,
      stdinText: bigInput,
    });
    expect(await runCli(environment)).toBe(exitCodes.done);
    const harness = composition.opened[0];
    const prompt = harness?.inputs[0]?.text ?? "";
    expect(prompt).toContain("stored as result r1");
    expect(prompt).toContain("row 0\nrow 1");
    expect(prompt).not.toContain("row 1999");
    expect(await harness?.results.readText("r1", { startLine: 2000, lineCount: 1 })).toBe(
      "row 1999",
    );
  });

  it("does not read stdin with -p when stdin is not a pipe", async () => {
    const composition = compositionWithTurn(textTurn("done"));
    const environment = createTestEnvironment({
      argv: ["-p", "hi"],
      composition,
      stdinText: "should be ignored",
      stdinMode: "other",
    });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(composition.opened[0]?.inputs[0]?.text).toBe("hi");
  });

  it("denies a write by default, naming --permission-mode, and exits 1", async () => {
    const environment = createTestEnvironment({
      argv: ["-p", "write notes"],
      composition: compositionWithTurn(writeFileTurn),
    });
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.errors()).toContain(
      `✗ write_file notes.md · Denied: ${oneShotDenialFeedback("auto-edit").slice(0, 20)}`,
    );
    expect(environment.errors()).toContain(
      "pass --permission-mode auto-edit to allow file changes",
    );
  });

  it("applies the write with --permission-mode auto-edit", async () => {
    const environment = createTestEnvironment({
      argv: ["-p", "write notes", "--permission-mode", "auto-edit"],
      composition: compositionWithTurn(writeFileTurn),
    });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(environment.output()).toBe("Wrote notes.md.\n");
    expect(environment.errors()).toBe("● write_file notes.md · 12 tokens · 5 ms\n");
  });

  it("prints JSON with --json and never prints the token", async () => {
    const composition = compositionWithTurn(async function* () {
      yield { type: "text", delta: "answer" };
      yield { type: "turn-end", reason: "error", message: "HTTP 401 with token sk-live-42" };
    });
    const environment = createTestEnvironment({ argv: ["-p", "x", "--json"], composition });
    environment.environment.LM_API_TOKEN = "sk-live-42";
    expect(await runCli(environment)).toBe(exitCodes.failed);
    const document = JSON.parse(environment.output());
    expect(document).toMatchObject({
      text: "answer",
      reason: "error",
      exitCode: 1,
      message: "HTTP 401 with token [redacted]",
      model: "google/gemma-4-12b-qat",
      toolCalls: [],
      denials: [],
    });
    expect(environment.output() + environment.errors()).not.toContain("sk-live-42");
  });

  it("passes flags and the one-shot prompter to the harness, and closes it", async () => {
    const composition = createFakeComposition();
    const environment = createTestEnvironment({
      argv: ["-p", "x", "--model", "qwen/qwen3-8b", "--ephemeral"],
      composition,
    });
    await runCli(environment);
    const options = composition.openedWith[0];
    expect(options?.config.model.default).toBe("qwen/qwen3-8b");
    expect(options?.ephemeral).toBe(true);
    expect(
      await options?.approvalPrompter.ask({
        tool: { name: "delete", permission: "write" },
        preview: { summary: "Trash a", targetPaths: ["/work/a"] },
        reason: "delete always asks",
      }),
    ).toEqual({ kind: "deny", feedback: oneShotDenialFeedback("auto-edit") });
    expect(composition.opened[0]?.closed).toBe(true);
  });
});

describe("clankr wipe", () => {
  it("wipes with --yes", async () => {
    const composition = createFakeComposition();
    const environment = createTestEnvironment({ argv: ["wipe", "--yes"], composition });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(composition.wipeCount).toBe(1);
    expect(environment.output()).toBe("Deleted 3 sessions and freed 2.5 MB.\n");
  });

  it("refuses without --yes when there is no terminal to confirm on", async () => {
    const composition = createFakeComposition();
    const environment = createTestEnvironment({ argv: ["wipe"], composition });
    expect(await runCli(environment)).toBe(exitCodes.usage);
    expect(composition.wipeCount).toBe(0);
  });
});

describe("one-shot denial text", () => {
  it("names no flag when none would help, and says why", async () => {
    const { OneShotApprovalPrompter, describeDenial } = await import("./one-shot-prompter.ts");
    const prompter = new OneShotApprovalPrompter();
    const answer = await prompter.ask({
      tool: { name: "query_sql", permission: "execute" },
      preview: { summary: "Run SQL over payroll.xlsx", targetPaths: [] },
      reason: "runs code on /elsewhere/payroll.xlsx",
      runFlag: "none",
    });
    expect(answer).toMatchObject({ kind: "deny" });
    if (answer.kind !== "deny") return;
    expect(answer.feedback).toMatch(/no run flag allows this/);
    expect(answer.feedback).not.toMatch(/--allow-data/);
    const [denial] = prompter.denials;
    expect(denial && describeDenial(denial)).toMatch(
      /run clankr from the folder that holds the file/,
    );
  });
});
