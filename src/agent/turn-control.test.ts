// runTurn: permissions, cancellation, and reasoning.

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentEvent, ChatMessage, ToolDefinition } from "../contracts/index.ts";
import {
  type AgentLoopKitOptions,
  collectEvents,
  createAgentLoopKit,
  createTestSession,
  respond,
  toolCallBalance,
  toolMessageContents as toolMessages,
  toyReadTool,
} from "../testing/index.ts";
import { runTurn } from "./turn.ts";

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

async function startKit(options: AgentLoopKitOptions = {}) {
  const kit = await createAgentLoopKit(options);
  cleanups.push(kit.cleanup);
  return kit;
}

async function runOnce(options: AgentLoopKitOptions) {
  const kit = await startKit(options);
  const session = createTestSession();
  const events = await collectEvents(
    runTurn(kit.dependencies, session, "hi", new AbortController().signal),
  );
  return { ...kit, session, events };
}

function toolEnds(events: AgentEvent[]) {
  return events.filter((event) => event.type === "tool-end");
}

function expectWellFormed(history: ChatMessage[]): void {
  const { called, answered } = toolCallBalance(history);
  expect(answered).toEqual(called);
}

describe("runTurn: permissions", () => {
  it("passes the user's denial feedback back to the model", async () => {
    const { events, session, permissions } = await runOnce({
      denied: { write_note: "put it in drafts/ instead" },
      responses: [respond.toolCall("write_note", { path: "a.md", text: "x" }), respond.text("ok")],
    });
    expect(toolEnds(events)[0]).toMatchObject({ validity: "valid", error: "denied" });
    expect(toolMessages(session.messages)[0]).toBe(
      "The user denied this call and said: put it in drafts/ instead",
    );
    expect(permissions.checks[0]?.preview?.summary).toBe("Write a.md");
  });

  it("gates read tools without building a preview", async () => {
    const { permissions } = await runOnce({
      responses: [respond.toolCall("read_note", { path: "a.md" }), respond.text("ok")],
    });
    expect(permissions.checks[0]).toEqual({
      tool: { name: "read_note", permission: "read" },
      args: { path: "a.md" },
    });
  });

  it("does not let a tool result change permissions (SEC-7)", async () => {
    const { session } = await runOnce({
      responses: [respond.toolCall("read_note", { path: "a.md" }), respond.text("ok")],
    });
    expect(session.permissionMode).toBe("ask");
    expect(session.grants.tools.size).toBe(0);
  });
});

describe("runTurn: cancellation and reasoning", () => {
  it("cancels mid-tool and leaves every call answered", async () => {
    const hangingParameters = z.object({});
    const hangingTool: ToolDefinition<typeof hangingParameters> = {
      name: "hang",
      description: "Never finishes and ignores its signal.",
      parameters: hangingParameters,
      permission: "read",
      resultTokenCap: 100,
      groups: ["core"],
      run: () => new Promise(() => {}),
    };
    const kit = await startKit({
      tools: [hangingTool as ToolDefinition, toyReadTool],
      responses: [
        respond.toolCalls([
          { name: "hang", args: {} },
          { name: "read_note", args: { path: "a" } },
        ]),
      ],
    });
    const session = createTestSession();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    for await (const event of runTurn(kit.dependencies, session, "hi", controller.signal)) {
      events.push(event);
      // Abort after the tool has started running, so the race against the signal is tested.
      if (event.type === "tool-start") setTimeout(() => controller.abort(), 10);
    }
    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "cancelled" });
    expect(toolEnds(events)[0]).toMatchObject({ error: "cancelled" });
    expect(toolMessages(session.messages)).toEqual([
      "Cancelled by the user.",
      "Cancelled by the user.",
    ]);
    expectWellFormed(session.messages);
  });

  it("cancels mid-reply and keeps the partial text", async () => {
    const kit = await startKit({
      responses: [
        [
          { type: "text", delta: "partial " },
          { type: "text", delta: "never seen" },
          { type: "done", finishReason: "stop" },
        ],
      ],
    });
    const session = createTestSession();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    for await (const event of runTurn(kit.dependencies, session, "hi", controller.signal)) {
      events.push(event);
      if (event.type === "text") controller.abort();
    }
    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "cancelled" });
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "partial" });
  });

  it("forwards reasoning as events and never stores it", async () => {
    const { events, session, lm } = await runOnce({
      responses: [
        respond.reasoningThenText("SECRET-REASONING", "answer <think>INLINE-REASONING</think>ok"),
      ],
    });
    expect(events[1]).toEqual({ type: "reasoning", delta: "SECRET-REASONING" });
    const stored = JSON.stringify(session.messages);
    expect(stored).not.toContain("SECRET-REASONING");
    expect(stored).not.toContain("INLINE-REASONING");
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "answer ok" });
    expect(lm.requests[0]?.reasoning).toBe("on");
  });
});

describe("repeated refusals", () => {
  it("answers a repeat of a refused call without asking again, and stops the loop", async () => {
    const write = { path: "notes.md", text: "x" };
    const { events, permissions } = await runOnce({
      responses: Array.from({ length: 5 }, () => respond.toolCall("write_note", write)),
      denied: { write_note: "Outside the allowed folders." },
    });
    // Asked once; the repeats were answered from memory.
    expect(permissions.checks).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "turn-end", reason: "limit" });
    expect(toolEnds(events).length).toBeLessThan(5);
  });
});
