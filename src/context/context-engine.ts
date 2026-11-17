// The ContextEngine: budgets, capping, and the message list that is actually sent.
//
// Write-back: `prepareMessages` returns the system prompt followed by the history to keep, and
// the caller replaces its history with `messages.slice(1)` after every call. That keeps the
// session from growing forever. Between threshold crossings the slice equals the input history,
// so every request starts with exactly the same messages and LM Studio can reuse its prompt
// cache (CTX-9).
//
// A caller that does not write back still works: the engine remembers a compacted view ("the
// first N messages of the history read as this shorter list") and appends what came after.

import { createHash } from "node:crypto";
import type {
  CappedResult,
  ChatMessage,
  CompactionReport,
  Config,
  ContextBudgets,
  ContextEngine,
  LmClient,
  LoadedModel,
  PrepareMessagesInput,
  ResultProvenance,
  ResultStore,
  TokenUsage,
  ToolOutput,
  UsageSnapshot,
} from "../contracts/index.ts";
import {
  type ContextSettings,
  computeBudgets,
  computeWindowLimits,
  type WindowLimits,
} from "./budgets.ts";
import { Compactor } from "./compaction.ts";
import { capToolOutput } from "./result-preview.ts";
import { TokenLedger } from "./token-ledger.ts";

export interface ContextEngineOptions {
  lm: LmClient;
  results: ResultStore;
  config: Config;
  /** The loaded model. Without one, the configured default model and context length are used. */
  model?: LoadedModel;
}

interface CompactedView {
  sourceLength: number;
  sourceFingerprint: string;
  history: ChatMessage[];
}

export class ClankrContextEngine implements ContextEngine {
  private readonly lm: LmClient;
  private readonly results: ResultStore;
  private readonly settings: ContextSettings;
  private readonly ledger: TokenLedger;
  /** Sent as `ChatRequest.model`: the loaded instance id, or the configured key before a load. */
  private modelId: string;
  private currentBudgets: ContextBudgets;
  private limits: WindowLimits;
  private compactor: Compactor;
  private view: CompactedView | undefined;
  private lastInput: PrepareMessagesInput | undefined;
  private lastReport: CompactionReport | undefined;

  constructor(options: ContextEngineOptions) {
    this.lm = options.lm;
    this.results = options.results;
    this.settings = options.config.context;
    this.ledger = new TokenLedger(options.lm);
    this.modelId = options.model?.instanceId ?? options.config.model.default;
    const contextLength = options.model?.contextLength ?? options.config.model.contextLength;
    this.currentBudgets = computeBudgets(contextLength, this.settings);
    this.limits = computeWindowLimits(this.currentBudgets, this.settings);
    this.compactor = this.buildCompactor();
  }

  budgets(): ContextBudgets {
    return { ...this.currentBudgets };
  }

  /** The limits the engine works to: hard limit, compaction threshold and target. */
  windowLimits(): WindowLimits {
    return { ...this.limits };
  }

  /** The most recent compaction, automatic or manual. */
  lastCompaction(): CompactionReport | undefined {
    return this.lastReport;
  }

  capResult(
    output: ToolOutput,
    tokenCap: number,
    provenance: ResultProvenance,
  ): Promise<CappedResult> {
    return capToolOutput(output, tokenCap, provenance, this.ledger, this.results);
  }

  async prepareMessages(input: PrepareMessagesInput): Promise<ChatMessage[]> {
    this.lastInput = input;
    let history = this.applyView(input.history);
    const fixedTokens = await this.fixedTokens(input);
    if ((await this.compactor.measure(history, fixedTokens)) > this.limits.compactAbove) {
      const outcome = await this.compactor.compactToFit({ history, fixedTokens });
      history = outcome.history;
      this.rememberView(input.history, history, outcome.report);
    }
    this.ledger.recordSent(await this.ledger.measure(input.systemPrompt, input.tools, history));
    return [{ role: "system", content: input.systemPrompt }, ...history];
  }

  /**
   * Compacts now, whatever the usage (`/compact`). The caller may replace its history with the
   * result; if it does not, the engine's view still applies the compaction to later requests.
   */
  async compact(
    history: ChatMessage[],
  ): Promise<{ history: ChatMessage[]; report: CompactionReport }> {
    const outcome = await this.compactor.compactNow(this.applyView(history));
    this.rememberView(history, outcome.history, outcome.report);
    return outcome;
  }

  recordUsage(usage: TokenUsage): void {
    this.ledger.recordUsage(usage);
  }

  usage(): UsageSnapshot {
    return this.ledger.snapshot(this.currentBudgets.contextLength);
  }

  /** MOD-7: recompute every budget for the new window and compact now if the conversation no longer fits. */
  async onModelChanged(model: LoadedModel): Promise<void> {
    this.modelId = model.instanceId;
    this.ledger.reset();
    this.currentBudgets = computeBudgets(model.contextLength, this.settings);
    this.limits = computeWindowLimits(this.currentBudgets, this.settings);
    this.compactor = this.buildCompactor();
    if (this.lastInput) await this.prepareMessages(this.lastInput);
  }

  private buildCompactor(): Compactor {
    return new Compactor({
      lm: this.lm,
      modelId: this.modelId,
      ledger: this.ledger,
      results: this.results,
      settings: this.settings,
      limits: this.limits,
      contextLength: this.currentBudgets.contextLength,
    });
  }

  private async fixedTokens(input: PrepareMessagesInput): Promise<number> {
    const system: ChatMessage = { role: "system", content: input.systemPrompt };
    return (
      (await this.ledger.countMessages([system])) +
      (await this.ledger.countTools(input.tools)) +
      this.ledger.fixedOverhead()
    );
  }

  /** The history as the model sees it: the compacted view, then everything appended since. */
  private applyView(history: ChatMessage[]): ChatMessage[] {
    const view = this.view;
    if (!view) return history;
    const stillMatches =
      history.length >= view.sourceLength &&
      fingerprint(history.slice(0, view.sourceLength)) === view.sourceFingerprint;
    if (!stillMatches) {
      // The caller replaced its history (after /compact, /clear, or a resume): start afresh.
      this.view = undefined;
      return history;
    }
    return [...view.history, ...history.slice(view.sourceLength)];
  }

  private rememberView(
    source: ChatMessage[],
    compacted: ChatMessage[],
    report: CompactionReport,
  ): void {
    this.view = {
      sourceLength: source.length,
      sourceFingerprint: fingerprint(source),
      history: compacted,
    };
    this.lastReport = report;
  }
}

function fingerprint(messages: ChatMessage[]): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}
