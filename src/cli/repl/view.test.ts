// Drives the real Ink view through fake terminal streams: keys in, frames out.

import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { respond, ScriptedLmClient } from "../../testing/index.ts";
import {
  createFakeHarness,
  type FakeTurn,
  hangingTurn,
  scriptedLmTurn,
} from "../testing/fake-harness.ts";
import { ReplController } from "./controller.ts";
import { ReplApprovalPrompter } from "./repl-approval-prompter.ts";
import { mountReplView } from "./view.ts";

class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  private readonly queued: string[] = [];
  setRawMode(): this {
    return this;
  }
  setEncoding(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  read(): string | null {
    return this.queued.shift() ?? null;
  }
  type(text: string): void {
    this.queued.push(text);
    this.emit("readable");
  }
}

class FakeStdout extends EventEmitter {
  readonly isTTY = true;
  readonly columns = 100;
  readonly rows = 40;
  written = "";
  write(chunk: string, callback?: () => void): boolean {
    this.written += chunk;
    callback?.();
    return true;
  }
  get text(): string {
    return stripVTControlCharacters(this.written);
  }
}

const unmounts: (() => void)[] = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function mount(turn: FakeTurn) {
  const prompter = new ReplApprovalPrompter();
  const harness = createFakeHarness({ turn, approvalPrompter: prompter });
  const controller = new ReplController({ harness, workingDirectory: "/work" });
  prompter.connect(controller);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const instance = mountReplView(controller, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  });
  unmounts.push(() => instance.unmount());
  return { controller, stdin, stdout };
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const ctrlC = "\u0003";

describe("REPL view (Ink)", () => {
  it("streams a reply, shows a tool line, and returns to the prompt", async () => {
    const lm = new ScriptedLmClient([
      respond.toolCall("read_file", { path: "notes.md" }),
      respond.text("The notes list three tasks."),
    ]);
    const { stdin, stdout, controller } = mount(scriptedLmTurn(lm));
    await eventually(
      () => stdout.text.includes("google/gemma-4-12b-qat · context – · ask"),
      "status line",
    );

    stdin.type("summarize notes.md");
    await eventually(() => stdout.text.includes("› summarize notes.md"), "typed input");
    stdin.type("\r");
    await eventually(() => stdout.text.includes("The notes list three tasks."), "the reply");
    await eventually(() => !controller.getState().busy, "the turn to end");

    const text = stdout.text;
    const toolLine = text.indexOf("● read_file notes.md · 312 tokens · 420 ms");
    expect(toolLine).toBeGreaterThan(-1);
    expect(text.indexOf("The notes list three tasks.")).toBeGreaterThan(toolLine);
    await eventually(
      () => stdout.text.lastIndexOf("› ") > stdout.text.lastIndexOf("tasks."),
      "the prompt",
    );
  });

  it("survives Ctrl+C during a slow turn, and a second press exits", async () => {
    const { stdin, stdout, controller } = mount(hangingTurn());
    stdin.type("go");
    stdin.type("\r");
    // The live activity line replaces a bare "Working…" (it names the phase and what grows).
    await eventually(
      () => /writing answer · 3 words · \ds · Ctrl\+C to cancel/.test(stdout.text),
      "the activity line",
    );

    stdin.type(ctrlC);
    await eventually(() => stdout.text.includes("Cancelled."), "the cancellation");
    await eventually(() => stdout.text.includes("Press Ctrl+C again to exit."), "the exit hint");
    expect(controller.getState().exited).toBe(false);

    stdin.type(ctrlC);
    await controller.whenExited();
  });

  it("draws the approval prompt with the diff and its three choices", async () => {
    const turn: FakeTurn = async function* (_input, signal, context) {
      const answer = await context.approvalPrompter.ask(
        {
          tool: { name: "edit_file", permission: "write" },
          preview: {
            summary: "Edit notes.md",
            diff: "@@ -1 +1 @@\n-old line\n+new line",
            targetPaths: ["/work/notes.md"],
          },
          reason: "write tools ask in ask mode",
        },
        signal,
      );
      yield { type: "text", delta: `answer was ${answer.kind}` };
      yield { type: "turn-end", reason: "done" };
    };
    const { stdin, stdout } = mount(turn);
    stdin.type("edit");
    stdin.type("\r");
    await eventually(() => stdout.text.includes("Allow edit_file?"), "the approval prompt");
    const text = stdout.text;
    expect(text).toContain("+new line");
    expect(text).toContain("-old line");
    expect(text).toContain("[o] once");
    expect(text).toContain("[a] always this session");
    expect(text).toContain("[d] deny with feedback");
    stdin.type("a");
    await eventually(() => stdout.text.includes("answer was session"), "the answer");
  });

  it("draws a secret question's answer as asterisks only", async () => {
    const { stdin, stdout, controller } = mount(hangingTurn());
    const answer = controller.ask("API token: ", { secret: true });
    await eventually(() => stdout.text.includes("API token: "), "the question");
    stdin.type("sk-abc");
    await eventually(() => stdout.text.includes("API token: ******"), "the masked answer");
    stdin.type("\r");
    expect(await answer).toBe("sk-abc");
    expect(stdout.text).not.toContain("sk-abc");
  });
});
