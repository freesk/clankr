import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { ChatMessage, LoadedModel, ToolSchema } from "../contracts/index.ts";
import { InMemoryResultStore, respond, ScriptedLmClient, testModel } from "../testing/index.ts";
import { parseSummary, summaryMarker } from "./compaction-note.ts";
import { ClankrContextEngine } from "./context-engine.ts";

const summaryReply = [
  "**Goal:** Find the 2025 invoices",
  "**Facts found:**",
  "- 12 invoices under ~/Documents/invoices_2025",
  "**Files touched:**",
  "- ~/Documents/invoices_2025/summary.md",
  "**Open steps:**",
  "- Total the amounts",
].join("\n");

const systemPrompt = "You are clankr, a local assistant.";
const tools: ToolSchema[] = [
  { name: "find_files", description: "Find files by name.", parameters: { type: "object" } },
];

function loadedModel(contextLength: number): LoadedModel {
  return {
    key: testModel.key,
    instanceId: "i",
    contextLength,
    capabilities: testModel.capabilities,
  };
}

function createEngine(contextLength: number, summaries = 20) {
  const lm = new ScriptedLmClient(
    Array.from({ length: summaries }, () => respond.text(summaryReply)),
  );
  const results = new InMemoryResultStore();
  const engine = new ClankrContextEngine({
    lm,
    results,
    config: defaultConfig(),
    model: loadedModel(contextLength),
  });
  return { lm, results, engine };
}

/** One turn: a request, a tool call, its result, and an answer. */
function turn(index: number, resultText: string, answerLength = 0): ChatMessage[] {
  const callId = `call_${index}`;
  return [
    { role: "user", content: `Request ${index}: look in folder ${index}` },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: callId, name: "find_files", argumentsJson: `{"path":"folder${index}"}` }],
    },
    { role: "tool", toolCallId: callId, content: resultText },
    {
      role: "assistant",
      content: `Folder ${index} has what you asked for.${".".repeat(answerLength)}`,
    },
  ];
}

async function requestTokens(lm: ScriptedLmClient, messages: ChatMessage[]): Promise<number> {
  const schema: ChatMessage = { role: "system", content: JSON.stringify(tools) };
  return (await lm.countTokens(messages)) + (await lm.countTokens([schema]));
}

describe("prepareMessages below the threshold", () => {
  it("sends the history unchanged and keeps the prefix stable between turns", async () => {
    const { engine, lm } = createEngine(16_384);
    const history = turn(1, "a.pdf");
    const first = await engine.prepareMessages({ systemPrompt, tools, history });
    expect(first).toEqual([{ role: "system", content: systemPrompt }, ...history]);

    history.push(...turn(2, "b.pdf"));
    const second = await engine.prepareMessages({ systemPrompt, tools, history });
    expect(second.slice(0, first.length)).toEqual(first);
    expect(lm.requests).toHaveLength(0);
  });
});

describe("eviction", () => {
  it("replaces old tool results with a stub that keeps the handle", async () => {
    const { engine, results, lm } = createEngine(4_000);
    const listing = Array.from({ length: 300 }, (_, index) => `file_${index}.txt`).join("\n");
    const capped = await engine.capResult({ text: listing }, 200, {
      tool: "find_files",
      arguments: { path: "folder1" },
    });
    const history = [...turn(1, capped.text)];
    // Two large results that age out, then two small recent ones.
    for (let index = 2; index <= 3; index++) history.push(...turn(index, "x".repeat(4_800)));
    for (let index = 4; index <= 5; index++) history.push(...turn(index, "small result"));

    const prepared = await engine.prepareMessages({ systemPrompt, tools, history });
    const toolMessages = prepared.filter((message) => message.role === "tool");
    expect(toolMessages[0]?.content).toMatch(/^\[Evicted old result of find_files/);
    expect(toolMessages[0]?.content).toContain(capped.handle as string);
    expect(toolMessages[1]?.content).toMatch(/^\[Evicted/);
    expect(toolMessages[2]?.content).toBe("x".repeat(4_800));
    expect(engine.lastCompaction()?.method).toBe("evicted");
    expect(lm.requests).toHaveLength(0);
    expect(await results.describe(capped.handle as string)).toBeTruthy();
  });
});

describe("summarizing compaction", () => {
  async function compactedSession() {
    const setup = createEngine(4_000);
    const capped = await setup.engine.capResult(
      { text: Array.from({ length: 400 }, (_, index) => `row ${index}`).join("\n") },
      150,
      { tool: "find_files", arguments: { path: "folder1" }, label: "rows of folder1" },
    );
    const history = [...turn(1, capped.text, 1_000)];
    for (let index = 2; index <= 10; index++)
      history.push(...turn(index, "y".repeat(1_200), 1_000));
    const prepared = await setup.engine.prepareMessages({ systemPrompt, tools, history });
    return { ...setup, capped, history, prepared };
  }

  it("summarizes older turns into the four-field note and fits the window", async () => {
    const { engine, lm, prepared } = await compactedSession();
    expect(engine.lastCompaction()?.method).toBe("summarized");
    expect(lm.requests).toHaveLength(1);
    const firstUser = prepared.find((message) => message.role === "user");
    const note = String(firstUser?.content);
    expect(note.startsWith(summaryMarker)).toBe(true);
    expect(note).toContain("Goal: Find the 2025 invoices");
    expect(note).toContain("Facts found:\n- 12 invoices");
    expect(note).toContain("Files touched:\n- ~/Documents/invoices_2025/summary.md");
    expect(note).toContain("- folder1");
    expect(note).toContain("Open steps:\n- Total the amounts");
    expect(prepared[0]).toEqual({ role: "system", content: systemPrompt });
    const limits = engine.windowLimits();
    expect(await requestTokens(lm, prepared)).toBeLessThanOrEqual(limits.hardLimit);
  });

  it("keeps a handle created before compaction resolvable", async () => {
    const { prepared, results, capped } = await compactedSession();
    const handle = capped.handle as string;
    const note = String(prepared.find((message) => message.role === "user")?.content);
    expect(note).toContain(`Stored results (read_result): ${handle} rows of folder1`);
    expect(await results.readText(handle, { startLine: 1, lineCount: 1 })).toBe("row 0");
  });

  it("reuses the compacted view on the next turn, so the prefix stays stable", async () => {
    const { engine, lm, history, prepared } = await compactedSession();
    history.push({ role: "user", content: "and one more thing" });
    const next = await engine.prepareMessages({ systemPrompt, tools, history });
    expect(next.slice(0, prepared.length)).toEqual(prepared);
    expect(lm.requests).toHaveLength(1);
  });

  it("falls back to a mechanical note when the summary call fails", async () => {
    const { engine, lm } = createEngine(4_000, 0);
    const history: ChatMessage[] = [];
    for (let index = 1; index <= 10; index++)
      history.push(...turn(index, "z".repeat(1_200), 1_000));
    const prepared = await engine.prepareMessages({ systemPrompt, tools, history });
    const note = String(prepared.find((message) => message.role === "user")?.content);
    expect(note).toContain("Goal: Request 1: look in folder 1");
    expect(note).toContain("- folder2");
    expect(await requestTokens(lm, prepared)).toBeLessThanOrEqual(engine.windowLimits().hardLimit);
  });
});

describe("guaranteed fit", () => {
  it("cuts a single message that is larger than the window", async () => {
    const { engine, lm } = createEngine(2_000);
    const history: ChatMessage[] = [{ role: "user", content: "q".repeat(40_000) }];
    const prepared = await engine.prepareMessages({ systemPrompt, tools, history });
    expect(await requestTokens(lm, prepared)).toBeLessThanOrEqual(engine.windowLimits().hardLimit);
    expect(String(prepared[1]?.content)).toContain("cut to fit the context window");
  });

  it("compacts instead of failing when the model changes to a smaller window", async () => {
    const { engine, lm } = createEngine(32_768);
    const history: ChatMessage[] = [];
    for (let index = 1; index <= 10; index++) history.push(...turn(index, "w".repeat(1_600)));
    const roomy = await engine.prepareMessages({ systemPrompt, tools, history });
    expect(roomy.length).toBe(history.length + 1);
    expect(lm.requests).toHaveLength(0);

    await engine.onModelChanged(loadedModel(4_096));
    expect(engine.budgets().contextLength).toBe(4_096);
    expect(engine.lastCompaction()).toBeDefined();
    const tight = await engine.prepareMessages({ systemPrompt, tools, history });
    expect(await requestTokens(lm, tight)).toBeLessThanOrEqual(engine.windowLimits().hardLimit);
  });
});

describe("compact (manual)", () => {
  it("summarizes every turn but the latest", async () => {
    const { engine } = createEngine(16_384);
    const history = [...turn(1, "a"), ...turn(2, "b"), ...turn(3, "c")];
    const { history: compacted, report } = await engine.compact(history);
    expect(report.method).toBe("summarized");
    expect(compacted).toHaveLength(4);
    expect(String(compacted[0]?.content)).toContain(summaryMarker);
    expect(String(compacted[0]?.content)).toContain("Request 3");
  });
});

describe("parseSummary", () => {
  it("reads headings in several styles and keeps underscores in names", () => {
    const fields = parseSummary(
      "Goal: total sales\n## Facts found\n* sales_2025.xlsx has 4 sheets\nFiles touched: none\nNext steps:\n1. chart it",
    );
    expect(fields.goal).toEqual(["total sales"]);
    expect(fields.facts).toEqual(["sales_2025.xlsx has 4 sheets"]);
    expect(fields.files).toEqual(["none"]);
    expect(fields.openSteps).toEqual(["1. chart it"]);
  });
});
