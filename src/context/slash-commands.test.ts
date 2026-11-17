import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { ChatMessage, SlashCommandContext } from "../contracts/index.ts";
import { InMemoryResultStore, respond, ScriptedLmClient } from "../testing/index.ts";
import { ClankrContextEngine } from "./context-engine.ts";
import { createContextCommands } from "./slash-commands.ts";

function setup(messages: ChatMessage[]) {
  const lm = new ScriptedLmClient([respond.text("Goal: g\nFacts found:\n- f\nOpen steps:\n- s")]);
  const config = defaultConfig();
  const engine = new ClankrContextEngine({ lm, results: new InMemoryResultStore(), config });
  const printed: string[] = [];
  const context: SlashCommandContext = {
    session: {
      id: "s",
      messages,
      model: undefined,
      permissionMode: "ask",
      grants: { tools: new Set(), dataFiles: new Set() },
      reasoning: "off",
      ephemeral: false,
    },
    config,
    lm,
    print: (text) => printed.push(text),
  };
  const [contextCommand, compactCommand] = createContextCommands(engine);
  if (!contextCommand || !compactCommand) throw new Error("commands missing");
  return { engine, context, printed, contextCommand, compactCommand };
}

const history: ChatMessage[] = [
  { role: "user", content: "first request" },
  { role: "assistant", content: "first answer" },
  { role: "user", content: "second request" },
];

describe("/context", () => {
  it("shows usage by the four categories and the budgets", async () => {
    const { engine, context, printed, contextCommand } = setup(history);
    await engine.prepareMessages({ systemPrompt: "system", tools: [], history });
    engine.recordUsage({ promptTokens: 100, completionTokens: 5 });
    await contextCommand.run("", context);
    const output = printed.join("\n");
    expect(contextCommand.name).toBe("context");
    expect(output).toContain("Context: 100 of 16,384 tokens (1%)");
    for (const label of ["System prompt", "Tool definitions", "History", "Tool results"]) {
      expect(output).toContain(label);
    }
    expect(output).toContain("response 4,096");
  });

  it("warns when the fixed overhead is over its budget", async () => {
    const { engine, context, printed, contextCommand } = setup(history);
    await engine.prepareMessages({ systemPrompt: "s".repeat(8_000), tools: [], history });
    await contextCommand.run("", context);
    expect(printed.join("\n")).toMatch(/Warning: system prompt and tools use [\d,]+ tokens/);
  });
});

describe("/compact", () => {
  it("replaces the session history with the compacted one and reports it", async () => {
    const { context, printed, compactCommand } = setup([...history]);
    await compactCommand.run("", context);
    expect(context.session.messages).toHaveLength(1);
    expect(String(context.session.messages[0]?.content)).toContain("second request");
    expect(printed[0]).toMatch(/^Compacted \(summarized older turns\)/);
  });

  it("says so when there is nothing to compact", async () => {
    const { context, printed, compactCommand } = setup([]);
    await compactCommand.run("", context);
    expect(printed).toEqual(["Nothing to compact yet."]);
  });
});
