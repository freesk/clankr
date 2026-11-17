import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../contracts/index.ts";
import { stripReasoningTags } from "./model-round.ts";
import { toPromptStyleMessages } from "./prompt-tool-style.ts";
import { ToolCallAssembler } from "./tool-call-assembly.ts";
import { extractToolCallsFromText, ToolCallTextFilter } from "./tool-call-text.ts";

describe("extractToolCallsFromText", () => {
  it("pulls out each block and keeps the prose", () => {
    const reply =
      'Checking.\n<tool_call>{"name": "a", "arguments": {"x": 1}}</tool_call>\n<tool_call>{"name": "b", "parameters": {}}</tool_call>';
    expect(extractToolCallsFromText(reply, "p")).toEqual({
      text: "Checking.",
      calls: [
        { id: "p_1", name: "a", argumentsJson: '{"x":1}' },
        { id: "p_2", name: "b", argumentsJson: "{}" },
      ],
    });
  });

  it("takes an unclosed block and keeps a broken one for the corrective error", () => {
    expect(
      extractToolCallsFromText('<tool_call>{"name": "a", "arguments": {}}', "p").calls,
    ).toEqual([{ id: "p_1", name: "a", argumentsJson: "{}" }]);
    const broken = extractToolCallsFromText(
      '<tool_call>{"name": "a", "arguments": {x</tool_call>',
      "p",
    );
    expect(broken.calls[0]).toMatchObject({
      name: "a",
      argumentsJson: '{"name": "a", "arguments": {x',
    });
  });
});

describe("ToolCallTextFilter", () => {
  function run(deltas: string[]): string {
    const filter = new ToolCallTextFilter();
    return deltas.map((delta) => filter.push(delta)).join("") + filter.flush();
  }

  it("hides blocks split across deltas", () => {
    expect(run(["a <tool", '_call>{"name"', ":1}</tool_", "call> b"])).toBe("a  b");
  });

  it("releases a held-back '<' that was not a tag", () => {
    expect(run(["x <", "y"])).toBe("x <y");
    expect(run(["x <tool"])).toBe("x <tool");
  });

  it("never shows an unclosed block", () => {
    expect(run(["a <tool_call>{"])).toBe("a ");
  });
});

describe("ToolCallAssembler", () => {
  it("joins argument deltas by index and fills missing ids", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ type: "tool-call-delta", index: 1, name: "b", argumentsDelta: "{}" });
    assembler.add({
      type: "tool-call-delta",
      index: 0,
      id: "c0",
      name: "a",
      argumentsDelta: '{"x"',
    });
    assembler.add({ type: "tool-call-delta", index: 0, argumentsDelta: ":1}" });
    expect(assembler.finish("f")).toEqual([
      { id: "c0", name: "a", argumentsJson: '{"x":1}' },
      { id: "f_2", name: "b", argumentsJson: "{}" },
    ]);
  });
});

describe("toPromptStyleMessages", () => {
  it("rewrites tool calls and results as text and merges adjacent user messages", () => {
    const history: ChatMessage[] = [
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "Looking.",
        toolCalls: [
          { id: "1", name: "a", argumentsJson: '{"x":1}' },
          { id: "2", name: "b", argumentsJson: "{bad" },
        ],
      },
      { role: "tool", toolCallId: "1", content: "A" },
      { role: "tool", toolCallId: "2", content: "B" },
      { role: "user", content: "next" },
    ];
    expect(toPromptStyleMessages(history)).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content:
          'Looking.\n<tool_call>{"name": "a", "arguments": {"x":1}}</tool_call>\n<tool_call>{"name": "b", "arguments": "{bad"}</tool_call>',
      },
      {
        role: "user",
        content:
          '<tool_result name="a">\nA\n</tool_result>\n\n<tool_result name="b">\nB\n</tool_result>\n\nnext',
      },
    ]);
  });
});

describe("stripReasoningTags", () => {
  it("removes closed and unclosed think blocks", () => {
    expect(stripReasoningTags("a<think>x</think>b<think>y")).toBe("ab");
  });
});
