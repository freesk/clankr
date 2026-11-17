// The M2 exit criterion: a scripted 50-turn session stays within the window the whole way,
// with eviction and summarizing compaction both observed.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { ChatMessage, CompactionReport, ToolSchema } from "../contracts/index.ts";
import {
  createTemporaryClankrPaths,
  respond,
  ScriptedLmClient,
  type TemporaryClankrPaths,
  testModel,
} from "../testing/index.ts";
import { ClankrContextEngine } from "./context-engine.ts";
import { DiskResultStore } from "./disk-result-store.ts";

const turns = 50;
const systemPrompt = `You are clankr, a local assistant for files and data. ${"Rules. ".repeat(60)}`;
const tools: ToolSchema[] = ["find_files", "search_content", "list_dir", "read_file"].map(
  (name) => ({
    name,
    description: `The ${name} tool. ${"Details. ".repeat(20)}`,
    parameters: { type: "object", properties: { path: { type: "string" } } },
  }),
);

/** Deterministic sizes, varied so some results pass through and some are stored. */
function resultSize(turn: number, round: number): number {
  return [400, 2_500, 9_000, 30_000, 1_200][(turn * 3 + round) % 5] ?? 400;
}

function toolOutput(turn: number, round: number): string {
  const lineCount = Math.ceil(resultSize(turn, round) / 40);
  return Array.from(
    { length: lineCount },
    (_, line) => `t${turn} r${round} ~/Documents/folder${turn}/file_${line}.txt  12 KB`,
  ).join("\n");
}

let temporary: TemporaryClankrPaths;

beforeEach(async () => {
  temporary = await createTemporaryClankrPaths();
});

afterEach(async () => {
  await temporary.cleanup();
});

describe("a scripted 50-turn session", () => {
  // "write-back" is how the agent loop runs: session history becomes messages.slice(1) each call.
  it.each([
    { contextLength: 16_384, writeBack: true },
    { contextLength: 8_192, writeBack: true },
    { contextLength: 16_384, writeBack: false },
    { contextLength: 8_192, writeBack: false },
  ])(
    "never overflows a $contextLength-token window (write-back: $writeBack)",
    async ({ contextLength, writeBack }) => {
      const summary =
        "Goal: tidy folders\nFacts found:\n- many files\nFiles touched:\nOpen steps:\n- continue";
      const lm = new ScriptedLmClient(Array.from({ length: turns }, () => respond.text(summary)));
      const results = new DiskResultStore(temporary.paths.session.results);
      const config = defaultConfig();
      const engine = new ClankrContextEngine({
        lm,
        results,
        config,
        model: {
          key: testModel.key,
          instanceId: "i",
          contextLength,
          capabilities: testModel.capabilities,
        },
      });
      const hardLimit = contextLength - engine.budgets().response;
      const toolTokens = await lm.countTokens([{ role: "system", content: JSON.stringify(tools) }]);

      let history: ChatMessage[] = [];
      const requestSizes: number[] = [];
      const compactions = new Set<CompactionReport>();
      let evictionSeen = false;
      let lastReport: CompactionReport | undefined;
      let firstHandle: string | undefined;

      /** One model call: prepare, check the fit independently, report usage like LM Studio would. */
      async function callModel(): Promise<void> {
        const messages = await engine.prepareMessages({ systemPrompt, tools, history });
        const promptTokens = (await lm.countTokens(messages)) + toolTokens + 3 * messages.length;
        expect(promptTokens).toBeLessThanOrEqual(hardLimit);
        requestSizes.push(promptTokens);
        if (messages.some((message) => String(message.content).startsWith("[Evicted"))) {
          evictionSeen = true;
        }
        engine.recordUsage({ promptTokens, completionTokens: 50 });
        const report = engine.lastCompaction();
        if (report) compactions.add(report);
        if (writeBack) {
          const kept = messages.slice(1);
          // Without a new compaction, write-back changes nothing, so the prefix stays stable.
          if (report === lastReport) expect(kept).toEqual(history);
          lastReport = report;
          history = kept;
        }
      }

      for (let turn = 1; turn <= turns; turn++) {
        history.push({
          role: "user",
          content: `Turn ${turn}: ${"please look at this folder ".repeat(4)}`,
        });
        const rounds = turn % 4 === 0 ? 2 : 1;
        for (let round = 1; round <= rounds; round++) {
          await callModel();
          const callId = `call_${turn}_${round}`;
          history.push({
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: callId,
                name: "find_files",
                argumentsJson: `{"path":"~/Documents/folder${turn}"}`,
              },
            ],
          });
          const capped = await engine.capResult(
            { text: toolOutput(turn, round) },
            config.context.defaultResultTokenCap,
            { tool: "find_files", arguments: { path: `~/Documents/folder${turn}` } },
          );
          firstHandle ??= capped.handle;
          history.push({ role: "tool", toolCallId: callId, content: capped.text });
        }
        await callModel();
        history.push({
          role: "assistant",
          content: `Done with turn ${turn}. ${"Summary text. ".repeat(30)}`,
        });
      }

      const snapshot = engine.usage();
      expect(snapshot.usedTokens).toBe(requestSizes.at(-1));
      expect(Math.max(...requestSizes)).toBeLessThanOrEqual(hardLimit);
      expect(evictionSeen).toBe(true);
      expect(lm.requests.length).toBeGreaterThan(0);
      expect(lm.requests.every((request) => request.reasoning === "off")).toBe(true);
      const methods = [...compactions].map((report) => report.method);
      expect(methods).toContain("summarized");
      expect(methods).toContain("evicted");

      // With write-back the session itself stays compact: it never holds more than fits the window.
      if (writeBack) {
        const appendedMessages = turns * 4 + Math.floor(turns / 4) * 2;
        expect(history.length).toBeLessThan(appendedMessages / 2);
        expect(await lm.countTokens(history)).toBeLessThanOrEqual(hardLimit);
      }

      // A handle from the first turns, long since summarized away, still resolves.
      expect(firstHandle).toBeDefined();
      const meta = await results.describe(firstHandle as string);
      expect(meta.itemCount).toBeGreaterThan(1);
    },
  );
});
