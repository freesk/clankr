// Budgets and result capping (seam: context → agent-loop, cli status line).

import type { ChatMessage, LoadedModel, TokenUsage, ToolSchema } from "./model.ts";
import type { ResultHandle, ResultProvenance } from "./results.ts";
import type { ToolOutput } from "./tools.ts";

/** Token budgets, recomputed from the loaded context length (PRD section 7.1). */
export interface ContextBudgets {
  contextLength: number;
  fixedOverhead: number;
  history: number;
  toolResults: number;
  response: number;
}

export interface UsageSnapshot {
  contextLength: number;
  usedTokens: number;
  byCategory: {
    system: number;
    toolDefinitions: number;
    history: number;
    toolResults: number;
  };
}

/** What the model sees in place of a tool's full output. */
export interface CappedResult {
  text: string;
  tokens: number;
  /** Set when the full output went to the result store. */
  handle?: ResultHandle;
}

export interface PrepareMessagesInput {
  systemPrompt: string;
  tools: ToolSchema[];
  history: ChatMessage[];
}

export interface CompactionReport {
  tokensBefore: number;
  tokensAfter: number;
  /** "evicted" when dropping old tool results was enough. */
  method: "evicted" | "summarized";
}

export interface ContextEngine {
  budgets(): ContextBudgets;
  capResult(
    output: ToolOutput,
    tokenCap: number,
    provenance: ResultProvenance,
  ): Promise<CappedResult>;
  /** The exact message list to send. Guarantees it fits, compacting as a last resort. */
  prepareMessages(input: PrepareMessagesInput): Promise<ChatMessage[]>;
  compact(history: ChatMessage[]): Promise<{ history: ChatMessage[]; report: CompactionReport }>;
  /** Reconcile the ledger with the usage a chat response reported. */
  recordUsage(usage: TokenUsage): void;
  usage(): UsageSnapshot;
  onModelChanged(model: LoadedModel): Promise<void>;
}
