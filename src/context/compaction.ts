// Compaction (CTX-4): first drop old tool results, then summarize older turns. As a last
// resort, cut oversized messages, so a request never overflows the window.

import type { ChatMessage, CompactionReport, ResultStore } from "../contracts/index.ts";
import type { ContextSettings, WindowLimits } from "./budgets.ts";
import { allButLatestRound, evictToolResults, olderThan } from "./eviction.ts";
import {
  messageText,
  prependToUserMessage,
  truncateMiddle,
  turnStartIndexes,
  withText,
} from "./message-text.ts";
import { type SummarizeOptions, summarizeMessages } from "./summarize.ts";
import type { TokenLedger } from "./token-ledger.ts";

/** Below this many characters a message is not worth cutting further. */
const smallestCuttableMessage = 200;

export interface CompactionInput {
  history: ChatMessage[];
  /** Tokens of the system prompt and tool definitions, which compaction never touches. */
  fixedTokens: number;
}

export interface CompactionOutcome {
  history: ChatMessage[];
  report: CompactionReport;
}

export interface CompactorOptions extends Omit<SummarizeOptions, "summaryTokens"> {
  ledger: TokenLedger;
  results: ResultStore;
  settings: ContextSettings;
  limits: WindowLimits;
}

export class Compactor {
  private readonly options: CompactorOptions;

  constructor(options: CompactorOptions) {
    this.options = options;
  }

  async measure(history: ChatMessage[], fixedTokens: number): Promise<number> {
    return fixedTokens + (await this.options.ledger.countMessages(history));
  }

  /** The automatic path, run when the request crosses the compaction threshold. */
  async compactToFit(input: CompactionInput): Promise<CompactionOutcome> {
    const { limits } = this.options;
    const tokensBefore = await this.measure(input.history, input.fixedTokens);
    const evicted = await this.evict(input.history, olderThan(this.ageLimit()));
    let history = evicted;
    let method: CompactionReport["method"] = "evicted";
    if ((await this.measure(history, input.fixedTokens)) > limits.compactTarget) {
      const split = await this.chooseSplit(history, input.fixedTokens);
      if (split > 0) {
        history = await this.summarizeBefore(history, split);
        method = "summarized";
      }
    }
    history = await this.enforceHardLimit(history, input.fixedTokens);
    const tokensAfter = await this.measure(history, input.fixedTokens);
    return { history, report: { tokensBefore, tokensAfter, method } };
  }

  /** The manual path (`/compact`): evict, then summarize every turn but the latest. */
  async compactNow(history: ChatMessage[]): Promise<CompactionOutcome> {
    const tokensBefore = await this.measure(history, 0);
    let compacted = await this.evict(history, olderThan(this.ageLimit()));
    let method: CompactionReport["method"] = "evicted";
    const latestTurn = turnStartIndexes(compacted).at(-1) ?? 0;
    if (latestTurn > 0) {
      compacted = await this.summarizeBefore(compacted, latestTurn);
      method = "summarized";
    }
    const tokensAfter = await this.measure(compacted, 0);
    return { history: compacted, report: { tokensBefore, tokensAfter, method } };
  }

  private ageLimit(): number {
    return this.options.settings.evictToolResultsAfterTurns;
  }

  private async evict(
    history: ChatMessage[],
    rule: ReturnType<typeof olderThan>,
  ): Promise<ChatMessage[]> {
    return (await evictToolResults(history, rule, this.options.results)).messages;
  }

  /**
   * The earliest turn boundary whose following turns, plus a note, fit under the target.
   * Always at least the latest turn is kept whole. Returns 0 when there is nothing older.
   */
  private async chooseSplit(history: ChatMessage[], fixedTokens: number): Promise<number> {
    const { limits } = this.options;
    const boundaries = turnStartIndexes(history).filter((index) => index > 0);
    const latest = boundaries.at(-1);
    if (latest === undefined) return 0;
    let chosen = latest;
    for (const boundary of [...boundaries].reverse()) {
      const kept = await this.measure(history.slice(boundary), fixedTokens);
      if (kept + limits.summaryTokens > limits.compactTarget) break;
      chosen = boundary;
    }
    return chosen;
  }

  private async summarizeBefore(history: ChatMessage[], split: number): Promise<ChatMessage[]> {
    const older = history.slice(0, split);
    const kept = history.slice(split);
    const note = await summarizeMessages(older, {
      ...this.options,
      summaryTokens: this.options.limits.summaryTokens,
    });
    const [firstKept, ...rest] = kept;
    // The note joins the first kept user message, so roles still alternate for strict templates.
    if (firstKept?.role === "user") return [prependToUserMessage(firstKept, note), ...rest];
    return [{ role: "user", content: note }, ...kept];
  }

  /** Last resort when the request still does not fit: evict recent results, then cut text. */
  private async enforceHardLimit(
    history: ChatMessage[],
    fixedTokens: number,
  ): Promise<ChatMessage[]> {
    const { hardLimit } = this.options.limits;
    if ((await this.measure(history, fixedTokens)) <= hardLimit) return history;
    let current = await this.evict(history, allButLatestRound(history));
    while ((await this.measure(current, fixedTokens)) > hardLimit) {
      const shortened = await this.cutLargestMessage(current);
      if (!shortened) {
        throw new Error(
          "The system prompt and tool definitions alone do not fit the context window. " +
            "Load the model with a longer context length.",
        );
      }
      current = shortened;
    }
    return current;
  }

  private async cutLargestMessage(history: ChatMessage[]): Promise<ChatMessage[] | undefined> {
    let largestIndex = -1;
    let largestLength = smallestCuttableMessage;
    history.forEach((message, index) => {
      const length = messageText(message).length;
      if (length > largestLength) {
        largestIndex = index;
        largestLength = length;
      }
    });
    const message = history[largestIndex];
    if (!message) return undefined;
    const shortened = truncateMiddle(messageText(message), Math.floor(largestLength / 2));
    const copy = [...history];
    copy[largestIndex] = withText(message, shortened);
    return copy;
  }
}
