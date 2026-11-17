import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../config/index.ts";
import type { ApprovalAnswer, SlashCommand } from "../../contracts/index.ts";
import { respond, ScriptedLmClient } from "../../testing/index.ts";
import {
  createFakeHarness,
  type FakeHarnessOptions,
  type FakeTurn,
  hangingTurn,
  scriptedLmTurn,
} from "../testing/fake-harness.ts";
import { ReplController } from "./controller.ts";
import { ReplApprovalPrompter } from "./repl-approval-prompter.ts";
import type { KeyPress, ReplState } from "./repl-state.ts";

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

function press(controller: ReplController, input: string, key: Partial<KeyPress> = {}): void {
  controller.handleKey(input, { ...noKey, ...key });
}

function typeLine(controller: ReplController, text: string): void {
  for (const character of text) press(controller, character);
  press(controller, "", { return: true });
}

function ctrlC(controller: ReplController): void {
  press(controller, "c", { ctrl: true });
}

function waitFor(controller: ReplController, predicate: (state: ReplState) => boolean) {
  return new Promise<ReplState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitFor timed out")), 2_000);
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

function setUp(options: FakeHarnessOptions = {}) {
  const prompter = new ReplApprovalPrompter();
  const harness = createFakeHarness({ approvalPrompter: prompter, ...options });
  const controller = new ReplController({ harness, workingDirectory: "/work" });
  prompter.connect(controller);
  return { harness, controller };
}

const idle = (state: ReplState) => !state.busy;
const entryTexts = (state: ReplState) =>
  state.entries.map((entry) => `${entry.kind}: ${entry.text}`);

describe("ReplController", () => {
  it("streams a reply from the scripted LmClient, shows a tool line, and returns to the prompt", async () => {
    const lm = new ScriptedLmClient([
      respond.toolCall("find_files", { pattern: "*.pdf" }),
      respond.text("You have 3 PDFs."),
    ]);
    const { controller } = setUp({ turn: scriptedLmTurn(lm) });
    typeLine(controller, "find my pdfs");
    expect(controller.getState().busy).toBe(true);
    const state = await waitFor(controller, idle);
    expect(entryTexts(state).slice(1)).toEqual([
      "user: find my pdfs",
      "tool: ● find_files *.pdf · 312 tokens · 420 ms",
      "assistant: You have 3 PDFs.",
    ]);
    expect(state.input).toBe("");
    expect(state.live).toBeUndefined();
    expect(state.statusLine).toBe("google/gemma-4-12b-qat · context – · ask");
  });

  it("shows text live while it streams, and reasoning apart from the answer", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const turn: FakeTurn = async function* () {
      yield { type: "reasoning", delta: "The user greets me." };
      yield { type: "text", delta: "Hel" };
      yield { type: "text", delta: "lo" };
      await gate;
      yield { type: "turn-end", reason: "done" };
    };
    const { controller } = setUp({ turn });
    typeLine(controller, "hi");
    const streaming = await waitFor(controller, (state) => state.live?.text === "Hello");
    expect(streaming.live?.reasoning).toBe("The user greets me.");
    release();
    const state = await waitFor(controller, idle);
    expect(entryTexts(state).slice(-2)).toEqual([
      "reasoning: thought · 4 words",
      "assistant: Hello",
    ]);
  });

  it("cancels a slow turn on Ctrl+C and survives; a second press exits", async () => {
    const { controller } = setUp({ turn: hangingTurn() });
    typeLine(controller, "do something slow");
    await waitFor(controller, (state) => state.live?.text === "thinking about it");

    ctrlC(controller);
    const state = await waitFor(controller, idle);
    expect(entryTexts(state).slice(-2)).toEqual([
      "assistant: thinking about it",
      "info: Cancelled.",
    ]);
    expect(state.exited).toBe(false);
    expect(state.notice).toBe("Press Ctrl+C again to exit.");

    ctrlC(controller);
    await controller.whenExited();
    expect(controller.getState().exited).toBe(true);
  });

  it("needs two presses in a row to exit when idle", () => {
    const { controller } = setUp();
    ctrlC(controller);
    expect(controller.getState().notice).toBe("Press Ctrl+C again to exit.");
    press(controller, "x");
    expect(controller.getState().notice).toBeUndefined();
    ctrlC(controller);
    expect(controller.getState().exited).toBe(false);
    ctrlC(controller);
    expect(controller.getState().exited).toBe(true);
  });

  it("asks for approval with the preview and passes deny feedback back", async () => {
    const answers: ApprovalAnswer[] = [];
    const turn: FakeTurn = async function* (_input, signal, context) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const answer = await context.approvalPrompter.ask(
          {
            tool: { name: "edit_file", permission: "write" },
            preview: {
              summary: "Edit notes.md",
              diff: "@@ -1 +1 @@\n-old\n+new",
              targetPaths: ["/work/notes.md"],
            },
            reason: "write tools ask in ask mode",
          },
          signal,
        );
        answers.push(answer);
      }
      yield { type: "turn-end", reason: "done" };
    };
    const { controller } = setUp({ turn });
    typeLine(controller, "edit it");

    const asking = await waitFor(controller, (state) => state.approval !== undefined);
    expect(asking.approval?.request.preview.diff).toContain("+new");
    press(controller, "", { return: true });
    expect(controller.getState().approval).toBeDefined();
    press(controller, "o");
    await waitFor(controller, (state) => state.approval !== undefined && answers.length === 1);
    press(controller, "a");
    await waitFor(controller, (state) => state.approval !== undefined && answers.length === 2);
    press(controller, "d");
    expect(controller.getState().approval?.stage).toBe("feedback");
    typeLine(controller, "use todo.md instead");
    await waitFor(controller, idle);
    expect(answers).toEqual([
      { kind: "once" },
      { kind: "session" },
      { kind: "deny", feedback: "use todo.md instead" },
    ]);
  });

  it("cancels the turn when Ctrl+C is pressed at an approval prompt", async () => {
    const turn: FakeTurn = async function* (_input, signal, context) {
      await context.approvalPrompter.ask(
        {
          tool: { name: "delete", permission: "write" },
          preview: { summary: "Trash a.txt", targetPaths: ["/work/a.txt"] },
          reason: "delete always asks",
        },
        signal,
      );
      yield { type: "turn-end", reason: "done" };
    };
    const { controller } = setUp({ turn });
    typeLine(controller, "delete a");
    await waitFor(controller, (state) => state.approval !== undefined);
    ctrlC(controller);
    const state = await waitFor(controller, idle);
    expect(state.approval).toBeUndefined();
    expect(entryTexts(state).at(-1)).toBe("info: Cancelled.");
  });

  it("cancels a long slash command with Ctrl+C, without exiting", async () => {
    const index: SlashCommand = {
      name: "index",
      summary: "Index a folder",
      run: (_argumentText, context) =>
        new Promise((resolve) => {
          context.signal?.addEventListener("abort", () => {
            context.print("Indexing cancelled.");
            resolve();
          });
        }),
    };
    const { controller } = setUp({ slashCommands: [index] });
    typeLine(controller, "/index ~/notes");
    await waitFor(controller, (state) => state.busy);
    ctrlC(controller);
    const state = await waitFor(controller, idle);
    expect(entryTexts(state).at(-1)).toBe("info: Indexing cancelled.");
    expect(state.exited).toBe(false);
  });

  it("offers a picker to slash commands and dispatches /clear and /exit", async () => {
    const model: SlashCommand = {
      name: "model",
      summary: "Switch model",
      run: async (_argumentText, context) => {
        const picked = await context.choose?.("Pick a model", [
          { label: "google/gemma-4-12b-qat", value: "gemma" },
          { label: "qwen/qwen3-8b", value: "qwen8" },
          { label: "qwen/qwen3-32b", value: "qwen32" },
        ]);
        context.print(`picked ${picked}`);
      },
    };
    const { controller, harness } = setUp({ slashCommands: [model] });
    typeLine(controller, "/model");
    await waitFor(controller, (state) => state.choice !== undefined);
    press(controller, "q");
    press(controller, "w");
    press(controller, "", { downArrow: true });
    press(controller, "", { return: true });
    let state = await waitFor(controller, idle);
    expect(entryTexts(state).at(-1)).toBe("info: picked qwen32");

    typeLine(controller, "/clear");
    state = await waitFor(controller, (current) => !current.busy && harness.newSessionCount === 1);
    expect(entryTexts(state).at(-1)).toBe(
      "info: Started a new session. The previous one stays saved.",
    );

    typeLine(controller, "/exit");
    await controller.whenExited();
  });

  it("passes dragged paths as attachments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clankr-cli-"));
    try {
      const imagePath = join(directory, "Screen Shot.png");
      await writeFile(imagePath, "png");
      const { controller, harness } = setUp();
      typeLine(controller, `what is ${imagePath.replace(" ", "\\ ")}`);
      const state = await waitFor(controller, idle);
      expect(harness.inputs[0]).toEqual({
        text: "what is [Screen Shot.png]",
        attachments: [{ path: imagePath, kind: "image", label: "[Screen Shot.png]" }],
      });
      expect(entryTexts(state)).toContain(`info: Attached: ${imagePath}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("shows a thrown error without the API token", async () => {
    const config = defaultConfig();
    config.lmStudio.apiToken = "sk-hidden";
    const turn: FakeTurn = async function* () {
      yield { type: "text", delta: "" };
      throw new Error("connection refused, token sk-hidden");
    };
    const { controller } = setUp({ turn, config });
    typeLine(controller, "hi");
    const state = await waitFor(controller, idle);
    expect(entryTexts(state).at(-1)).toBe("error: connection refused, token [redacted]");
  });
});

describe("reasoning summary", () => {
  it("collapses reasoning to a word count and shows nothing when there is none", async () => {
    const { reasoningSummary } = await import("./turn-presenter.ts");
    expect(reasoningSummary("Plan: inspect, then query.")).toBe("thought · 4 words");
    expect(reasoningSummary("one")).toBe("thought · 1 word");
    expect(reasoningSummary("  ")).toBe("");
  });
});
