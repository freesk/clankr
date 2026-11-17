// delegate inside the real main loop: only the summary reaches the main history, handles
// in the summary resolve, cancellation reaches the sub-agent, one sub-agent at a time.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runTurn } from "../agent/index.ts";
import { createReadResultTool } from "../context/index.ts";
import type { ToolDefinition } from "../contracts/index.ts";
import {
  collectEvents,
  PassThroughContextEngine,
  respond,
  toolMessageContents,
  toyReadTool,
} from "../testing/index.ts";
import { ReadOnlyPermissionGate } from "./read-only-tools.ts";
import { createParentKit, toolNamesSent } from "./sub-agent.test-support.ts";

const brief = "Read a.txt, b.txt and c.txt and say what they contain.";

function delegateCall(id = "p1") {
  return respond.toolCall("delegate", { brief }, id);
}

describe("delegate: in the main loop", () => {
  it("puts only the summary into the main history", async () => {
    const kit = await createParentKit({
      responses: [
        delegateCall(),
        respond.toolCall("read_note", { path: "a.txt" }, "s1"),
        respond.toolCall("read_note", { path: "b.txt" }, "s2"),
        respond.toolCall("read_note", { path: "c.txt" }, "s3"),
        respond.text("All three are short notes."),
        respond.text("The sub-agent says they are short notes."),
      ],
    });
    const events = await collectEvents(
      runTurn(kit.dependencies, kit.session, "check the notes", new AbortController().signal),
    );

    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "done" });
    expect(toolMessageContents(kit.session.messages)).toEqual(["All three are short notes."]);
    expect(JSON.stringify(kit.session.messages)).not.toContain("contents of");
    expect(kit.subAgentEvents.filter((event) => event.type === "tool-end")).toHaveLength(3);
  });

  it("offers delegate in the main loop but not to the sub-agent", async () => {
    const kit = await createParentKit({
      responses: [delegateCall(), respond.text("nothing"), respond.text("ok")],
    });
    await collectEvents(runTurn(kit.dependencies, kit.session, "go", new AbortController().signal));
    expect(toolNamesSent(kit.lm.requests[0])).toContain("delegate");
    expect(toolNamesSent(kit.lm.requests[1])).toEqual(["read_note"]);
    expect(kit.lm.requests[1]?.messages.slice(1)).toEqual([{ role: "user", content: brief }]);
  });

  it("marks a summary written at the turn limit", async () => {
    const kit = await createParentKit({
      configure: (config) => {
        config.subagents.turnLimit = 1;
      },
      responses: [
        delegateCall(),
        respond.toolCall("read_note", { path: "a.txt" }, "s1"),
        respond.text("Only a.txt was read."),
        respond.text("ok"),
      ],
    });
    await collectEvents(runTurn(kit.dependencies, kit.session, "go", new AbortController().signal));
    const [summary] = toolMessageContents(kit.session.messages);
    expect(summary).toContain("Only a.txt was read.");
    expect(summary).toContain("reached its turn limit");
  });
});

const storeParameters = z.object({ topic: z.string() });

/** A read tool that stores its output, as search does with a long hit list. */
const storingTool: ToolDefinition<typeof storeParameters> = {
  name: "store_note",
  description: "Store a long note.",
  parameters: storeParameters,
  permission: "read",
  resultTokenCap: 50,
  groups: ["core"],
  async run(args, context) {
    const handle = await context.results.putText(`full notes about ${args.topic}`, {
      tool: "store_note",
      arguments: args,
    });
    return { text: `stored as ${handle}`, handles: [handle] };
  },
};

describe("delegate: shared result store", () => {
  it("lets the main conversation read a handle named in the summary", async () => {
    let handle = "";
    const kit = await createParentKit({
      tools: [storingTool, toyReadTool],
      responses: [
        delegateCall(),
        respond.toolCall("store_note", { topic: "invoices" }, "s1"),
        (request) => {
          handle = /r\d+/.exec(String(request.messages.at(-1)?.content))?.[0] ?? "";
          return respond.text(`Invoices are summarised in ${handle}.`);
        },
        () => respond.toolCall("read_result", { handle }, "p2"),
        respond.text("done"),
      ],
    });
    kit.dependencies.tools.push(createReadResultTool(kit.dependencies.config));
    await collectEvents(runTurn(kit.dependencies, kit.session, "go", new AbortController().signal));

    expect(handle).toMatch(/^r\d+$/);
    const toolResults = toolMessageContents(kit.session.messages);
    expect(toolResults[0]).toBe(`Invoices are summarised in ${handle}.`);
    expect(toolResults[1]).toContain("full notes about invoices");
  });
});

describe("delegate: control", () => {
  it("cancelling the main turn stops the sub-agent", async () => {
    const controller = new AbortController();
    const kit = await createParentKit({
      responses: [
        delegateCall(),
        respond.toolCall("read_note", { path: "a.txt" }, "s1"),
        () => {
          controller.abort();
          return respond.text("too late");
        },
        respond.text("never sent"),
      ],
    });
    const events = await collectEvents(
      runTurn(kit.dependencies, kit.session, "go", controller.signal),
    );
    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "cancelled" });
    expect(kit.lm.remainingResponses).toBe(1);
  });

  it("runs one sub-agent at a time", async () => {
    const kit = await createParentKit({
      delegate: { createContextEngine: () => new PassThroughContextEngine() },
      responses: [respond.text("first")],
    });
    const context = kit.createToolContext(new AbortController().signal);
    const first = kit.delegateTool.run({ brief }, context);
    await expect(kit.delegateTool.run({ brief }, context)).rejects.toThrow("already running");
    await expect(first).resolves.toEqual({ text: "first" });
  });

  it("refuses to run without a loaded model", async () => {
    const kit = await createParentKit({ responses: [] });
    const { model: _model, ...context } = kit.createToolContext(new AbortController().signal);
    await expect(kit.delegateTool.run({ brief }, context)).rejects.toThrow("No model is loaded");
  });

  it("reports each finished delegation", async () => {
    const results: unknown[] = [];
    const kit = await createParentKit({
      delegate: { onResult: (result) => results.push(result) },
      responses: [respond.text("found it")],
    });
    await kit.delegateTool.run({ brief }, kit.createToolContext(new AbortController().signal));
    expect(results).toEqual([
      {
        summary: "found it",
        summaryTokens: expect.any(Number),
        endReason: "done",
        truncated: false,
        toolCalls: { valid: 0, repaired: 0, invalid: 0 },
      },
    ]);
  });
});

describe("ReadOnlyPermissionGate", () => {
  it("refuses write, execute and delegate without asking the inner gate", async () => {
    const kit = await createParentKit({ responses: [] });
    const gate = new ReadOnlyPermissionGate(kit.permissions);
    for (const tool of [
      { name: "write_note", permission: "write" as const },
      { name: "run_js", permission: "execute" as const },
      { name: "delegate", permission: "read" as const },
    ]) {
      expect((await gate.check(tool, {})).allowed).toBe(false);
    }
    expect(kit.permissions.checks).toEqual([]);
    expect(await gate.check({ name: "read_note", permission: "read" }, {})).toEqual({
      allowed: true,
    });
  });
});
