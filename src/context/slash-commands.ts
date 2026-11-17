// `/context` shows the ledger (CTX-1); `/compact` compacts on demand (CTX-4).
// The commands close over the engine, because a slash command's context does not carry it.

import type {
  CompactionReport,
  ContextBudgets,
  ContextEngine,
  SlashCommand,
  UsageSnapshot,
} from "../contracts/index.ts";

export function createContextCommands(engine: ContextEngine): SlashCommand[] {
  return [contextCommand(engine), compactCommand(engine)];
}

function contextCommand(engine: ContextEngine): SlashCommand {
  return {
    name: "context",
    summary: "Show how the context window is used",
    usage: "/context",
    async run(_argumentText, context) {
      context.print(formatUsage(engine.usage(), engine.budgets()));
    },
  };
}

function compactCommand(engine: ContextEngine): SlashCommand {
  return {
    name: "compact",
    summary: "Drop old tool results and summarize older turns now",
    usage: "/compact",
    async run(_argumentText, context) {
      if (context.session.messages.length === 0) {
        context.print("Nothing to compact yet.");
        return;
      }
      const { history, report } = await engine.compact(context.session.messages);
      context.session.messages = history;
      context.print(formatCompaction(report));
    },
  };
}

export function formatUsage(usage: UsageSnapshot, budgets: ContextBudgets): string {
  const { byCategory } = usage;
  const fixed = byCategory.system + byCategory.toolDefinitions;
  const rows: [string, number][] = [
    ["System prompt", byCategory.system],
    ["Tool definitions", byCategory.toolDefinitions],
    ["History", byCategory.history],
    ["Tool results", byCategory.toolResults],
  ];
  const lines = [
    `Context: ${number(usage.usedTokens)} of ${number(usage.contextLength)} tokens (${percent(usage.usedTokens, usage.contextLength)})`,
    ...rows.map(([label, tokens]) => `  ${label.padEnd(18)}${number(tokens).padStart(8)}`),
    `Budgets: fixed ${number(budgets.fixedOverhead)}, history ${number(budgets.history)}, ` +
      `tool results ${number(budgets.toolResults)}, response ${number(budgets.response)}`,
  ];
  if (fixed > budgets.fixedOverhead) {
    lines.push(
      `Warning: system prompt and tools use ${number(fixed)} tokens, over the ${number(budgets.fixedOverhead)} budget.`,
    );
  }
  return lines.join("\n");
}

export function formatCompaction(report: CompactionReport): string {
  const how =
    report.method === "summarized" ? "summarized older turns" : "dropped old tool results";
  return `Compacted (${how}): ${number(report.tokensBefore)} to ${number(report.tokensAfter)} tokens.`;
}

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}
