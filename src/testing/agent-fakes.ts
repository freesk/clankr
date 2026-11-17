// Fakes for testing anything that drives the agent loop: a context engine that passes
// messages through, and a permission gate that decides by tool name.

import type {
  CappedResult,
  ChangePreview,
  ChatMessage,
  CompactionReport,
  ContextBudgets,
  ContextEngine,
  GateDecision,
  GatedTool,
  PermissionGate,
  PrepareMessagesInput,
  ResultProvenance,
  TokenUsage,
  ToolOutput,
  UsageSnapshot,
} from "../contracts/index.ts";

const charactersPerToken = 4;

/**
 * Sends the system prompt and the whole history, and never stores a result. A result over
 * its cap is cut to the cap with a marker, so tests can see the cap was applied.
 */
export class PassThroughContextEngine implements ContextEngine {
  readonly prepared: PrepareMessagesInput[] = [];
  readonly cappedCalls: { output: ToolOutput; tokenCap: number; provenance: ResultProvenance }[] =
    [];
  readonly usages: TokenUsage[] = [];
  private readonly contextLength: number;

  constructor(contextLength = 16_384) {
    this.contextLength = contextLength;
  }

  budgets(): ContextBudgets {
    const share = (fraction: number) => Math.floor(this.contextLength * fraction);
    return {
      contextLength: this.contextLength,
      fixedOverhead: share(0.1),
      history: share(0.45),
      toolResults: share(0.2),
      response: share(0.25),
    };
  }

  async capResult(
    output: ToolOutput,
    tokenCap: number,
    provenance: ResultProvenance,
  ): Promise<CappedResult> {
    this.cappedCalls.push({ output, tokenCap, provenance });
    const maxCharacters = tokenCap * charactersPerToken;
    const text =
      output.text.length > maxCharacters
        ? `${output.text.slice(0, maxCharacters)}\n[truncated]`
        : output.text;
    return { text, tokens: Math.ceil(text.length / charactersPerToken) };
  }

  async prepareMessages(input: PrepareMessagesInput): Promise<ChatMessage[]> {
    this.prepared.push({ ...input, history: [...input.history] });
    return [{ role: "system", content: input.systemPrompt }, ...input.history];
  }

  async compact(
    history: ChatMessage[],
  ): Promise<{ history: ChatMessage[]; report: CompactionReport }> {
    return { history, report: { tokensBefore: 0, tokensAfter: 0, method: "evicted" } };
  }

  recordUsage(usage: TokenUsage): void {
    this.usages.push(usage);
  }

  usage(): UsageSnapshot {
    return {
      contextLength: this.contextLength,
      usedTokens: 0,
      byCategory: { system: 0, toolDefinitions: 0, history: 0, toolResults: 0 },
    };
  }

  async onModelChanged(): Promise<void> {}
}

/** Allows every tool except those named in `denied`, which get the given feedback. */
export class NamedPermissionGate implements PermissionGate {
  readonly checks: { tool: GatedTool; args: Record<string, unknown>; preview?: ChangePreview }[] =
    [];
  private readonly denied: Map<string, string>;

  constructor(denied: Record<string, string> = {}) {
    this.denied = new Map(Object.entries(denied));
  }

  async check(
    tool: GatedTool,
    args: Record<string, unknown>,
    preview?: ChangePreview,
  ): Promise<GateDecision> {
    this.checks.push(preview ? { tool, args, preview } : { tool, args });
    const feedback = this.denied.get(tool.name);
    return feedback === undefined ? { allowed: true } : { allowed: false, feedback };
  }
}
