import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { ChatEvent, LoadedModel } from "../contracts/index.ts";
import { InMemoryResultStore, ScriptedLmClient, testModel } from "../testing/index.ts";
import { VixContextEngine } from "./context-engine.ts";

function loadedModel(contextLength: number): LoadedModel {
  return {
    key: testModel.key,
    instanceId: "test:1",
    contextLength,
    capabilities: testModel.capabilities,
  };
}

function createEngine(contextLength = 16_384) {
  const lm = new ScriptedLmClient();
  const results = new InMemoryResultStore();
  const engine = new VixContextEngine({
    lm,
    results,
    config: defaultConfig(),
    model: loadedModel(contextLength),
  });
  return { lm, results, engine };
}

const provenance = { tool: "search_content", arguments: { pattern: "invoice" } };

describe("budgets", () => {
  it("are fractions of the context length and follow a model change", async () => {
    const { engine } = createEngine(16_384);
    expect(engine.budgets()).toEqual({
      contextLength: 16_384,
      fixedOverhead: 1_638,
      history: 7_372,
      toolResults: 3_276,
      response: 4_096,
    });
    await engine.onModelChanged(loadedModel(32_768));
    const doubled = engine.budgets();
    expect(doubled.fixedOverhead).toBe(3_276);
    expect(doubled.history).toBe(14_745);
    expect(doubled.toolResults).toBe(6_553);
    expect(doubled.response).toBe(8_192);
  });
});

describe("capResult", () => {
  it("passes output under the cap through unchanged", async () => {
    const { engine, results } = createEngine();
    const capped = await engine.capResult({ text: "short" }, 100, provenance);
    expect(capped).toEqual({ text: "short", tokens: 2 });
    expect(results.handles()).toEqual([]);
  });

  it("stores over-cap output and returns a head and tail preview within the cap", async () => {
    const { engine, results, lm } = createEngine();
    const lines = Array.from({ length: 2_000 }, (_, index) => `match ${index + 1}: invoice.pdf`);
    const capped = await engine.capResult({ text: lines.join("\n") }, 200, provenance);

    expect(capped.handle).toBe("r1");
    expect(capped.tokens).toBeLessThanOrEqual(200);
    expect(await lm.countTokens([{ role: "user", content: capped.text }])).toBe(capped.tokens);
    expect(capped.text).toContain("stored as r1");
    expect(capped.text).toContain("read_result");
    expect(capped.text).toContain("match 1: invoice.pdf");
    expect(capped.text).toContain("match 2000: invoice.pdf");
    expect(capped.text).toMatch(/lines omitted/);
    expect(await results.readText("r1", { startLine: 1000, lineCount: 1 })).toBe(
      "match 1000: invoice.pdf",
    );
    expect((await results.describe("r1")).arguments).toEqual({ pattern: "invoice" });
  });

  it("passes short corrective error messages through, empty text included", async () => {
    const { engine, results } = createEngine();
    const error = "Invalid arguments for find_files: pattern is required. Try again.";
    expect((await engine.capResult({ text: error }, 800, provenance)).text).toBe(error);
    expect(await engine.capResult({ text: "" }, 800, provenance)).toEqual({ text: "", tokens: 0 });
    expect(results.handles()).toEqual([]);
  });

  it("cuts a single enormous line instead of overflowing the cap", async () => {
    const { engine } = createEngine();
    const capped = await engine.capResult({ text: "x".repeat(50_000) }, 100, provenance);
    expect(capped.handle).toBe("r1");
    expect(capped.tokens).toBeLessThanOrEqual(100);
  });
});

describe("token ledger", () => {
  const input = {
    systemPrompt: "You are vix.".repeat(10),
    tools: [{ name: "find_files", description: "Find files.", parameters: { type: "object" } }],
    history: [
      { role: "user" as const, content: "Find my invoices please" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "c1", name: "find_files", argumentsJson: '{"pattern":"invoice"}' }],
      },
      { role: "tool" as const, toolCallId: "c1", content: "a.pdf\nb.pdf\n".repeat(20) },
    ],
  };

  it("reports usage by the four categories", async () => {
    const { engine } = createEngine();
    await engine.prepareMessages(input);
    const usage = engine.usage();
    expect(usage.byCategory.system).toBeGreaterThan(0);
    expect(usage.byCategory.toolDefinitions).toBeGreaterThan(0);
    expect(usage.byCategory.history).toBeGreaterThan(0);
    expect(usage.byCategory.toolResults).toBeGreaterThan(0);
    const { system, toolDefinitions, history, toolResults } = usage.byCategory;
    expect(usage.usedTokens).toBe(system + toolDefinitions + history + toolResults);
  });

  it("matches the prompt tokens LM Studio reported for the same request", async () => {
    const { engine } = createEngine();
    await engine.prepareMessages(input);
    engine.recordUsage({ promptTokens: 321, completionTokens: 10 });
    const usage = engine.usage();
    expect(usage.usedTokens).toBe(321);
    const { system, toolDefinitions, history, toolResults } = usage.byCategory;
    expect(system + toolDefinitions + history + toolResults).toBe(321);
  });

  it("learns the template overhead from reported usage", async () => {
    const { engine } = createEngine();
    await engine.prepareMessages(input);
    const estimated = engine.usage().usedTokens;
    engine.recordUsage({ promptTokens: estimated + 40, completionTokens: 1 });
    await engine.prepareMessages(input);
    // Same request, now estimated with the measured overhead: matches what was reported.
    expect(engine.usage().usedTokens).toBe(estimated + 40);
  });

  it("ignores a usage report with no prompt count", async () => {
    const { engine } = createEngine();
    await engine.prepareMessages(input);
    const before = engine.usage();
    engine.recordUsage({ promptTokens: 0, completionTokens: 0 });
    expect(engine.usage()).toEqual(before);
  });
});

describe("summary request", () => {
  it("is sent with reasoning off", async () => {
    const { engine, lm } = createEngine();
    const reply: ChatEvent[] = [
      { type: "text", delta: "Goal: x\nFacts found:\n- y\nFiles touched:\nOpen steps:\n- z" },
      { type: "done", finishReason: "stop" },
    ];
    lm.enqueue(reply);
    await engine.compact([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ]);
    expect(lm.requests[0]?.reasoning).toBe("off");
    expect(lm.requests[0]?.model).toBe(loadedModel(16_384).instanceId);
  });
});
