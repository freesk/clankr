// runSubAgent: fresh context, read-only tools, turn limit, summary cap, cancellation.

import { describe, expect, it } from "vitest";
import { type ChatMessage, ToolError } from "../contracts/index.ts";
import { respond, toyReadTool, toyWrites, toyWriteTool } from "../testing/index.ts";
import { createDelegateTool } from "./delegate-tool.ts";
import { runSubAgent, SubAgentError, type SubAgentLimits } from "./run-sub-agent.ts";
import { createSubAgentKit, toolNamesSent } from "./sub-agent.test-support.ts";

const limits: SubAgentLimits = { turnLimit: 8, summaryTokenCap: 300 };
const brief = "List the notes under docs/ and say which mention invoices.";

function readCall(path: string, id: string) {
  return respond.toolCall("read_note", { path }, id);
}

describe("runSubAgent: a normal delegation", () => {
  it("runs three tool calls and returns the final reply as the summary", async () => {
    const kit = await createSubAgentKit({
      responses: [
        readCall("a.txt", "s1"),
        readCall("b.txt", "s2"),
        readCall("c.txt", "s3"),
        respond.text("b.txt mentions invoices."),
      ],
    });
    const result = await runSubAgent(brief, [toyReadTool, toyWriteTool], limits, kit.environment);

    expect(result).toMatchObject({
      summary: "b.txt mentions invoices.",
      endReason: "done",
      truncated: false,
      toolCalls: { valid: 3, repaired: 0, invalid: 0 },
    });
    expect(kit.lm.requests).toHaveLength(4);
    expect(kit.events.filter((event) => event.type === "tool-start")).toHaveLength(3);
  });

  it("starts from a system prompt and the brief only", async () => {
    const kit = await createSubAgentKit({ responses: [respond.text("nothing found")] });
    await runSubAgent(brief, [toyReadTool], limits, kit.environment);

    const messages = kit.lm.requests[0]?.messages as ChatMessage[];
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]).toEqual({ role: "user", content: brief });
    expect(messages[0]?.content).toContain("You are a sub-agent");
    expect(messages[0]?.content).toContain("at most 300 tokens");
  });

  it("uses the session's loaded model", async () => {
    const kit = await createSubAgentKit({ responses: [respond.text("done")] });
    await runSubAgent(brief, [toyReadTool], limits, kit.environment);
    expect(kit.lm.requests[0]?.model).toBe(kit.environment.model.key);
    expect(kit.lm.loads).toEqual([]);
  });
});

describe("runSubAgent: tool set", () => {
  it("offers read tools only, never write tools or delegate", async () => {
    const kit = await createSubAgentKit({ responses: [respond.text("done")] });
    const delegate = createDelegateTool({
      config: kit.environment.config,
      tools: [],
      permissions: kit.permissions,
    });
    await runSubAgent(brief, [toyReadTool, toyWriteTool, delegate], limits, kit.environment);
    expect(toolNamesSent(kit.lm.requests[0])).toEqual(["read_note"]);
  });

  it("rejects a call to a write tool or to delegate as an unknown tool", async () => {
    const writesBefore = toyWrites.length;
    const kit = await createSubAgentKit({
      responses: [
        respond.toolCalls([
          { name: "write_note", args: { path: "x.txt", text: "hi" }, id: "w1" },
          { name: "delegate", args: { brief: "nest" }, id: "d1" },
        ]),
        respond.text("could not write"),
      ],
    });
    const result = await runSubAgent(brief, [toyReadTool, toyWriteTool], limits, kit.environment);

    expect(toyWrites.length).toBe(writesBefore);
    expect(kit.permissions.checks).toEqual([]);
    expect(result.toolCalls).toEqual({ valid: 0, repaired: 0, invalid: 2 });
  });

  it("sends every sub-agent call through the session's gate", async () => {
    const kit = await createSubAgentKit({
      responses: [readCall("a.txt", "s1"), respond.text("done")],
    });
    await runSubAgent(brief, [toyReadTool], limits, kit.environment);
    expect(kit.permissions.checks.map((check) => check.tool.name)).toEqual(["read_note"]);
  });
});

describe("runSubAgent: turn limit", () => {
  it("asks for a summary without tools when the limit is reached", async () => {
    const kit = await createSubAgentKit({
      responses: [
        readCall("a.txt", "s1"),
        readCall("b.txt", "s2"),
        respond.text("Partial: a.txt and b.txt read, no invoices yet."),
      ],
    });
    const result = await runSubAgent(
      brief,
      [toyReadTool],
      { ...limits, turnLimit: 2 },
      kit.environment,
    );

    expect(result.endReason).toBe("limit");
    expect(result.summary).toBe("Partial: a.txt and b.txt read, no invoices yet.");
    const summaryRequest = kit.lm.requests[2];
    expect(summaryRequest?.tools).toBeUndefined();
    const lastMessage = summaryRequest?.messages.at(-1);
    expect(lastMessage?.role).toBe("user");
    expect(lastMessage?.content).toContain("used all your tool turns");
  });

  it("still returns a summary when the model writes nothing at the limit", async () => {
    const kit = await createSubAgentKit({ responses: [readCall("a.txt", "s1"), respond.text("")] });
    const result = await runSubAgent(
      brief,
      [toyReadTool],
      { ...limits, turnLimit: 1 },
      kit.environment,
    );
    expect(result.summary).toBe("The sub-agent stopped without writing a summary.");
  });
});

describe("runSubAgent: summary cap", () => {
  const longSummary = "word ".repeat(200).trim();

  it("asks for a shorter summary, then truncates if it is still over the cap", async () => {
    const kit = await createSubAgentKit({
      responses: [respond.text(longSummary), respond.text(longSummary)],
    });
    const cap = 20;
    const result = await runSubAgent(
      brief,
      [toyReadTool],
      { ...limits, summaryTokenCap: cap },
      kit.environment,
    );

    const rewriteRequest = kit.lm.requests[1];
    expect(rewriteRequest?.tools).toBeUndefined();
    expect(rewriteRequest?.messages.at(-1)?.content).toContain("the limit is 20");
    expect(result.truncated).toBe(true);
    expect(result.summaryTokens).toBeLessThanOrEqual(cap);
    const counted = await kit.lm.countTokens([{ role: "assistant", content: result.summary }]);
    expect(counted).toBeLessThanOrEqual(cap);
    expect(result.summary).toContain("summary cut to fit");
  });

  it("keeps a rewritten summary that fits", async () => {
    const kit = await createSubAgentKit({
      responses: [respond.text(longSummary), respond.text("Short version.")],
    });
    const result = await runSubAgent(
      brief,
      [toyReadTool],
      { ...limits, summaryTokenCap: 20 },
      kit.environment,
    );
    expect(result).toMatchObject({ summary: "Short version.", truncated: false });
  });
});

describe("runSubAgent: cancellation and failure", () => {
  it("stops when the main turn's signal is aborted", async () => {
    const kit = await createSubAgentKit({
      responses: [
        readCall("a.txt", "s1"),
        () => {
          kit.controller.abort();
          return respond.text("too late");
        },
        respond.text("never sent"),
      ],
    });
    await expect(runSubAgent(brief, [toyReadTool], limits, kit.environment)).rejects.toThrow();
    expect(kit.lm.remainingResponses).toBe(1);
  });

  it("reports a failed loop as a SubAgentError", async () => {
    const kit = await createSubAgentKit({ responses: [] });
    const failure = runSubAgent(brief, [toyReadTool], limits, kit.environment);
    await expect(failure).rejects.toBeInstanceOf(SubAgentError);
    await expect(failure).rejects.not.toBeInstanceOf(ToolError);
  });
});
