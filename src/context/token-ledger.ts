// The token ledger (CTX-1): counts what a request costs, by category, and reconciles
// the estimate with the usage LM Studio reports after each call.

import type {
  ChatMessage,
  LmClient,
  TokenUsage,
  ToolSchema,
  UsageSnapshot,
} from "../contracts/index.ts";

/**
 * Tokens a chat template adds around each message, assumed until the first reported usage
 * replaces it with a measured value. Erring high only makes compaction start a little early.
 */
const initialPerMessageOverhead = 4;

export type UsageCategories = UsageSnapshot["byCategory"];

/** What one request costs, as content counts before template overhead is added. */
export interface RequestMeasurement {
  content: UsageCategories;
  messageCount: number;
  /** Message count per category, so overhead can be attributed. */
  messagesByCategory: { system: number; history: number; toolResults: number };
}

export class TokenLedger {
  private readonly lm: LmClient;
  private readonly cache = new Map<string, number>();
  private perMessageOverhead = initialPerMessageOverhead;
  private lastMeasurement: RequestMeasurement | undefined;
  private lastReportedPromptTokens: number | undefined;

  constructor(lm: LmClient) {
    this.lm = lm;
  }

  async countMessage(message: ChatMessage): Promise<number> {
    return this.countCached(JSON.stringify(message), [message]);
  }

  async countText(text: string): Promise<number> {
    return this.countMessage({ role: "user", content: text });
  }

  /** Tool definitions reach the model as JSON schema, so that is what is counted. */
  async countTools(tools: ToolSchema[]): Promise<number> {
    if (tools.length === 0) return 0;
    const schemaText = JSON.stringify(tools);
    return this.countCached(`tools:${schemaText}`, [{ role: "system", content: schemaText }]);
  }

  async countMessages(messages: ChatMessage[]): Promise<number> {
    let total = 0;
    for (const message of messages) total += await this.countMessage(message);
    return Math.ceil(total + messages.length * this.perMessageOverhead);
  }

  async measure(
    systemPrompt: string,
    tools: ToolSchema[],
    history: ChatMessage[],
  ): Promise<RequestMeasurement> {
    const measurement: RequestMeasurement = {
      content: {
        system: await this.countMessage({ role: "system", content: systemPrompt }),
        toolDefinitions: await this.countTools(tools),
        history: 0,
        toolResults: 0,
      },
      messageCount: history.length + 1,
      messagesByCategory: { system: 1, history: 0, toolResults: 0 },
    };
    for (const message of history) {
      const category = message.role === "tool" ? "toolResults" : "history";
      measurement.content[category] += await this.countMessage(message);
      measurement.messagesByCategory[category] += 1;
    }
    return measurement;
  }

  /** The estimated prompt size of a measured request, template overhead included. */
  total(measurement: RequestMeasurement): number {
    return Math.ceil(sumCategories(this.withOverhead(measurement)));
  }

  /** Marks a measured request as the one being sent, so reported usage can be matched to it. */
  recordSent(measurement: RequestMeasurement): void {
    this.lastMeasurement = measurement;
    this.lastReportedPromptTokens = undefined;
  }

  /** The reported prompt size is the truth; the gap to the content count is template overhead. */
  recordUsage(usage: TokenUsage): void {
    const measurement = this.lastMeasurement;
    if (!measurement || usage.promptTokens <= 0) return;
    this.lastReportedPromptTokens = usage.promptTokens;
    const contentTotal = sumCategories(measurement.content);
    const overhead = usage.promptTokens - contentTotal;
    this.perMessageOverhead = Math.max(0, overhead / measurement.messageCount);
  }

  snapshot(contextLength: number): UsageSnapshot {
    const empty = { system: 0, toolDefinitions: 0, history: 0, toolResults: 0 };
    if (!this.lastMeasurement) return { contextLength, usedTokens: 0, byCategory: empty };
    const estimated = this.withOverhead(this.lastMeasurement);
    const reported = this.lastReportedPromptTokens;
    const byCategory =
      reported === undefined ? roundCategories(estimated) : scaleTo(estimated, reported);
    return { contextLength, usedTokens: sumCategories(byCategory), byCategory };
  }

  /** A new model has a new tokenizer and chat template: start counting afresh. */
  reset(): void {
    this.cache.clear();
    this.perMessageOverhead = initialPerMessageOverhead;
    this.lastMeasurement = undefined;
    this.lastReportedPromptTokens = undefined;
  }

  private withOverhead(measurement: RequestMeasurement): UsageCategories {
    const overhead = this.perMessageOverhead;
    const counts = measurement.messagesByCategory;
    return {
      system: measurement.content.system + counts.system * overhead,
      toolDefinitions: measurement.content.toolDefinitions,
      history: measurement.content.history + counts.history * overhead,
      toolResults: measurement.content.toolResults + counts.toolResults * overhead,
    };
  }

  private async countCached(key: string, messages: ChatMessage[]): Promise<number> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const count = await this.lm.countTokens(messages);
    this.cache.set(key, count);
    return count;
  }
}

function sumCategories(categories: UsageCategories): number {
  return (
    categories.system + categories.toolDefinitions + categories.history + categories.toolResults
  );
}

function roundCategories(categories: UsageCategories): UsageCategories {
  return {
    system: Math.ceil(categories.system),
    toolDefinitions: Math.ceil(categories.toolDefinitions),
    history: Math.ceil(categories.history),
    toolResults: Math.ceil(categories.toolResults),
  };
}

/** Scales the categories so they add up to exactly `total`, giving rounding leftovers to history. */
function scaleTo(categories: UsageCategories, total: number): UsageCategories {
  const sum = sumCategories(categories);
  const factor = sum > 0 ? total / sum : 0;
  const scaled = {
    system: Math.floor(categories.system * factor),
    toolDefinitions: Math.floor(categories.toolDefinitions * factor),
    history: Math.floor(categories.history * factor),
    toolResults: Math.floor(categories.toolResults * factor),
  };
  scaled.history += total - sumCategories(scaled);
  return scaled;
}
