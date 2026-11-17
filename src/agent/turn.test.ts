// runTurn: basic turns, malformed calls, and limits.

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

async function runOnce(options: AgentLoopKitOptions, input = "hi") {
  const kit = await startKit(options);
  const session = createTestSession();
  const events = await collectEvents(
    runTurn(kit.dependencies, session, input, new AbortController().signal),
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

describe("runTurn: basic turns", () => {
  it("streams a text-only turn and stores it", async () => {
    const { events, session } = await runOnce({ responses: [respond.text("hello")] });
    expect(events).toEqual([
      { type: "text", delta: "hello" },
      { type: "turn-end", reason: "done" },
    ]);
    expect(session.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("runs a tool call and feeds the result back", async () => {
    const { events, session, lm, context } = await runOnce({
      responses: [respond.toolCall("read_note", { path: "a.md" }), respond.text("done")],
    });
    expect(events.map((event) => event.type)).toEqual([
      "tool-start",
      "tool-end",
      "text",
      "turn-end",
    ]);
    expect(events[0]).toEqual({
      type: "tool-start",
      callId: "call_1",
      tool: "read_note",
      keyArgument: "a.md",
    });
    expect(events[1]).toMatchObject({ type: "tool-end", callId: "call_1", validity: "valid" });
    expect(events[1]).not.toHaveProperty("error");
    expect(toolMessages(session.messages)).toEqual(["contents of a.md"]);
    expect(lm.requests[0]?.tools?.map((tool) => tool.name)).toEqual(["read_note", "write_note"]);
    expect(lm.requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_1",
      content: "contents of a.md",
    });
    expect(context.cappedCalls[0]?.tokenCap).toBe(toyReadTool.resultTokenCap);
    expect(context.usages).toHaveLength(2);
    expectWellFormed(session.messages);
  });

  it("lists attachments in the user message", async () => {
    const kit = await startKit({ responses: [respond.text("ok")] });
    const session = createTestSession();
    await collectEvents(
      runTurn(
        kit.dependencies,
        session,
        { text: "look", attachmentPaths: ["/tmp/a.png"] },
        new AbortController().signal,
      ),
    );
    expect(session.messages[0]).toEqual({
      role: "user",
      content: "look\n\nAttached files:\n- /tmp/a.png",
    });
  });

  it("ends with an error when no model is loaded", async () => {
    const kit = await startKit();
    const session = createTestSession();
    session.model = undefined;
    const events = await collectEvents(
      runTurn(kit.dependencies, session, "hi", new AbortController().signal),
    );
    expect(events).toEqual([
      { type: "turn-end", reason: "error", message: expect.stringContaining("/model") },
    ]);
  });

  it("turns a failing model call into turn-end error", async () => {
    const { events, session } = await runOnce({
      responses: [
        () => {
          throw new Error("LM Studio is not running");
        },
      ],
    });
    expect(events).toEqual([
      { type: "turn-end", reason: "error", message: "LM Studio is not running" },
    ]);
    expectWellFormed(session.messages);
  });
});

describe("runTurn: malformed calls", () => {
  it("repairs a number sent as a string and drops an unknown field", async () => {
    const { events, session } = await runOnce({
      responses: [
        respond.rawToolCall("read_note", '{"path":"a.md","line":"3","colour":"red"}'),
        respond.text("ok"),
      ],
    });
    expect(toolEnds(events)[0]).toMatchObject({ validity: "repaired" });
    expect(toolMessages(session.messages)).toEqual(["contents of a.md from line 3"]);
  });

  it("rejects an unrepairable call with a corrective error, and the retry succeeds", async () => {
    const { events, session } = await runOnce({
      responses: [
        respond.rawToolCall("read_note", '{"line": 2}'),
        respond.toolCall("read_note", { path: "a.md" }),
        respond.text("ok"),
      ],
    });
    expect(toolEnds(events).map((event) => event.validity)).toEqual(["invalid", "valid"]);
    const [correction, result] = toolMessages(session.messages);
    expect(correction).toContain('"path"');
    expect(correction).toContain("read_note(path: string, line?: integer)");
    expect(result).toBe("contents of a.md");
    expect(events.at(-1)).toEqual({ type: "turn-end", reason: "done" });
  });

  it("answers an unknown tool with the list of available tools", async () => {
    const { events, session } = await runOnce({
      responses: [respond.toolCall("shell", { command: "ls" }), respond.text("ok")],
    });
    expect(toolEnds(events)[0]).toMatchObject({ validity: "invalid", error: "invalid arguments" });
    expect(toolMessages(session.messages)[0]).toBe(
      'Unknown tool "shell". Available tools: read_note, write_note.',
    );
  });

  it("passes a ToolError's message through and hides any other error", async () => {
    const brokenParameters = z.object({});
    const brokenTool: ToolDefinition<typeof brokenParameters> = {
      name: "broken",
      description: "Always fails.",
      parameters: brokenParameters,
      permission: "read",
      resultTokenCap: 100,
      groups: ["core"],
      async run() {
        throw new Error("ENOENT /Users/secret/path at Object.<anonymous>");
      },
    };
    const { session } = await runOnce({
      tools: [toyReadTool, brokenTool as ToolDefinition],
      responses: [
        respond.toolCalls([
          { name: "read_note", args: { path: "missing.txt" } },
          { name: "broken", args: {} },
        ]),
        respond.text("ok"),
      ],
    });
    expect(toolMessages(session.messages)).toEqual([
      "missing.txt does not exist.",
      "broken failed unexpectedly. Try different arguments or another tool.",
    ]);
  });
});

describe("runTurn: limits", () => {
  it("ends the turn after too many invalid calls in a row", async () => {
    const invalid = respond.rawToolCall("read_note", "{not json");
    const { events, lm, session } = await runOnce({ responses: [invalid, invalid, invalid] });
    expect(events.at(-1)).toMatchObject({ type: "turn-end", reason: "limit" });
    expect(lm.requests).toHaveLength(3);
    expectWellFormed(session.messages);
  });

  it("ends the turn when the round limit is reached", async () => {
    const kit = await startKit({
      responses: [
        respond.toolCall("read_note", { path: "a" }),
        respond.toolCall("read_note", { path: "b" }),
      ],
    });
    kit.dependencies.config.agent.maxToolRoundsPerTurn = 2;
    const session = createTestSession();
    const events = await collectEvents(
      runTurn(kit.dependencies, session, "hi", new AbortController().signal),
    );
    expect(events.at(-1)).toMatchObject({
      type: "turn-end",
      reason: "limit",
      message: expect.stringContaining("2 tool rounds"),
    });
    expect(kit.lm.remainingResponses).toBe(0);
  });
});
