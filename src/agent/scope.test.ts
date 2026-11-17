// Tool scoping and calling styles, driven through runTurn (CTX-8, MOD-6, D15, DATA-16).

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentEvent, ChatEvent, ToolDefinition } from "../contracts/index.ts";
import {
  collectEvents,
  createAgentLoopKit,
  createTestSession,
  respond,
  type ScriptedResponse,
  toyReadTool,
} from "../testing/index.ts";
import { runTurn } from "./turn.ts";
import type { AgentDependencies, ToolReference } from "./types.ts";

const noParameters = z.object({});

function toolInGroup(name: string, group: "vision" | "data"): ToolDefinition {
  const tool: ToolDefinition<typeof noParameters> = {
    name,
    description: `Stand-in for ${name}.`,
    parameters: noParameters,
    permission: "read",
    resultTokenCap: 100,
    groups: [group],
    run: async () => ({ text: "ok" }),
  };
  return tool as ToolDefinition;
}

const viewImage = toolInGroup("view_image", "vision");
const inspectData = toolInGroup("inspect_data", "data");
const makeChart = toolInGroup("make_chart", "data");
const allTools = [toyReadTool as ToolDefinition, viewImage, inspectData, makeChart];

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

async function startKit(responses: ScriptedResponse[]) {
  const kit = await createAgentLoopKit({ tools: allTools, responses });
  cleanups.push(kit.cleanup);
  const dependencies: AgentDependencies = kit.dependencies;
  return { ...kit, dependencies };
}

function offeredNames(tools: { name: string }[] | undefined): string[] {
  return (tools ?? []).map((tool) => tool.name);
}

describe("tool scoping", () => {
  it("offers view_image only to a model with vision", async () => {
    const kit = await startKit([respond.text("a"), respond.text("b")]);
    const signal = new AbortController().signal;
    await collectEvents(runTurn(kit.dependencies, createTestSession(), "hi", signal));
    await collectEvents(
      runTurn(kit.dependencies, createTestSession({ vision: false }), "hi", signal),
    );
    expect(offeredNames(kit.lm.requests[0]?.tools)).toEqual(["read_note", "view_image"]);
    expect(offeredNames(kit.lm.requests[1]?.tools)).toEqual(["read_note"]);
  });

  it("adds the data tools on the round after a .xlsx path appears in a tool result", async () => {
    const kit = await startKit([
      respond.toolCall("read_note", { path: "q3/sales.xlsx" }),
      respond.text("found it"),
    ]);
    const session = createTestSession({ vision: false });
    await collectEvents(
      runTurn(kit.dependencies, session, "find the sales file", new AbortController().signal),
    );
    expect(offeredNames(kit.lm.requests[0]?.tools)).toEqual(["read_note"]);
    expect(offeredNames(kit.lm.requests[1]?.tools)).toEqual([
      "read_note",
      "inspect_data",
      "make_chart",
    ]);
    expect(session.activatedToolGroups).toEqual(["data"]);
  });

  it("adds the data tools when the user's message names a data file", async () => {
    const kit = await startKit([respond.text("ok")]);
    const session = createTestSession({ vision: false });
    await collectEvents(
      runTurn(
        kit.dependencies,
        session,
        { text: "profile this", attachmentPaths: ["/d/a.csv"] },
        new AbortController().signal,
      ),
    );
    expect(offeredNames(kit.lm.requests[0]?.tools)).toContain("inspect_data");
  });

  it("keeps the data tools once activated, even after the path leaves history", async () => {
    const kit = await startKit([respond.text("ok")]);
    const session = createTestSession({ vision: false });
    session.activatedToolGroups = ["data"];
    await collectEvents(runTurn(kit.dependencies, session, "hi", new AbortController().signal));
    expect(offeredNames(kit.lm.requests[0]?.tools)).toContain("make_chart");
  });

  it("does not activate the data tools from the model's own text", async () => {
    const kit = await startKit([respond.text("try report.xlsx"), respond.text("ok")]);
    const session = createTestSession({ vision: false });
    const signal = new AbortController().signal;
    await collectEvents(runTurn(kit.dependencies, session, "hi", signal));
    await collectEvents(runTurn(kit.dependencies, session, "and?", signal));
    expect(offeredNames(kit.lm.requests[1]?.tools)).toEqual(["read_note"]);
  });
});

describe("tool references", () => {
  const chartReference: ToolReference = {
    toolName: "make_chart",
    text: "VEGA-LITE REFERENCE",
    triggerWords: ["chart", "plot"],
  };

  function systemPromptOf(request: { messages: { role: string; content: unknown }[] } | undefined) {
    const system = request?.messages[0];
    return system?.role === "system" ? String(system.content) : "";
  }

  it("loads the reference when the user asks for a chart and the tool is offered", async () => {
    const kit = await startKit([respond.text("ok"), respond.text("ok")]);
    kit.dependencies.toolReferences = [chartReference];
    const session = createTestSession({ vision: false });
    const signal = new AbortController().signal;
    await collectEvents(runTurn(kit.dependencies, session, "chart it", signal));
    await collectEvents(runTurn(kit.dependencies, session, "chart sales.csv", signal));
    expect(systemPromptOf(kit.lm.requests[0])).not.toContain("VEGA-LITE REFERENCE");
    expect(systemPromptOf(kit.lm.requests[1])).toContain("VEGA-LITE REFERENCE");
  });

  it("keeps the reference for 3 turns after a make_chart call, then drops it", async () => {
    const kit = await startKit([
      respond.toolCall("make_chart", {}),
      respond.text("drawn"),
      respond.text("1"),
      respond.text("2"),
      respond.text("3"),
      respond.text("4"),
    ]);
    kit.dependencies.toolReferences = [chartReference];
    const session = createTestSession({ vision: false });
    session.activatedToolGroups = ["data"];
    const signal = new AbortController().signal;
    for (const input of ["draw it", "a", "b", "c", "d"]) {
      await collectEvents(runTurn(kit.dependencies, session, input, signal));
    }
    const loaded = kit.lm.requests.map((request) =>
      systemPromptOf(request).includes("VEGA-LITE REFERENCE"),
    );
    expect(loaded).toEqual([false, true, true, true, true, false]);
  });
});

describe("prompt-based tool calling", () => {
  it("is used for a model without tool training, and hides the markup from the user", async () => {
    const reply: ChatEvent[] = [
      { type: "text", delta: "Let me look. <tool_ca" },
      {
        type: "text",
        delta: 'll>{"name": "read_note", "arguments": {"path": "a.md"}}</tool_call>',
      },
      { type: "done", finishReason: "stop" },
    ];
    const kit = await startKit([reply, respond.text("It says hello.")]);
    const session = createTestSession({ trainedForToolUse: false, vision: false });
    const events = await collectEvents(
      runTurn(kit.dependencies, session, "read a.md", new AbortController().signal),
    );

    const first = kit.lm.requests[0];
    expect(first?.tools).toBeUndefined();
    expect(String(first?.messages[0]?.content)).toContain(
      "read_note(path: string, line?: integer)",
    );

    const shownText = events
      .filter((event): event is Extract<AgentEvent, { type: "text" }> => event.type === "text")
      .map((event) => event.delta)
      .join("");
    expect(shownText).toBe("Let me look. It says hello.");
    expect(events.find((event) => event.type === "tool-end")).toMatchObject({ validity: "valid" });

    const second = kit.lm.requests[1];
    expect(second?.messages.some((message) => message.role === "tool")).toBe(false);
    expect(second?.messages.at(-1)).toEqual({
      role: "user",
      content: '<tool_result name="read_note">\ncontents of a.md\n</tool_result>',
    });
    // Stored history keeps the native shape.
    expect(session.messages.some((message) => message.role === "tool")).toBe(true);
  });

  it("follows the per-model profile over the reported capability", async () => {
    const kit = await startKit([respond.text("ok")]);
    const session = createTestSession();
    const modelKey = session.model?.key ?? "";
    kit.dependencies.config.model.profiles[modelKey] = {
      toolCallingStyle: "prompt",
      temperature: 1,
    };
    await collectEvents(runTurn(kit.dependencies, session, "hi", new AbortController().signal));
    expect(kit.lm.requests[0]?.tools).toBeUndefined();
    expect(kit.lm.requests[0]?.sampling).toEqual({ temperature: 1 });
  });
});
