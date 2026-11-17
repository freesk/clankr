// The sub-agent runner (CTX-6, PRD section 7.3): a full agent loop in a fresh context that
// holds only the brief, with read-only tools and its own turn limit, ending in a capped summary.

import { type AgentDependencies, runTurn } from "../agent/index.ts";
import type {
  AgentEvent,
  ChatMessage,
  Config,
  ContextEngine,
  LmClient,
  LoadedModel,
  PermissionGate,
  ReasoningSetting,
  SessionState,
  ToolContext,
  ToolDefinition,
  TurnEndReason,
} from "../contracts/index.ts";
import {
  missingSummaryRequest,
  noSummaryText,
  shortenSummaryRequest,
  subAgentInstructions,
  turnLimitSummaryRequest,
} from "./instructions.ts";
import { ReadOnlyPermissionGate, readOnlyTools } from "./read-only-tools.ts";
import { capSummary } from "./summary-cap.ts";

export interface SubAgentLimits {
  /** Tool rounds before the sub-agent is told to summarise (D18). */
  turnLimit: number;
  summaryTokenCap: number;
}

export function subAgentLimitsFrom(config: Config): SubAgentLimits {
  return {
    turnLimit: config.subagents.turnLimit,
    summaryTokenCap: config.subagents.summaryTokenCap,
  };
}

/** What the sub-agent shares with the main session: the model, the gate, and the tool context. */
export interface SubAgentEnvironment {
  lm: LmClient;
  /** The model already loaded for the session. A sub-agent never loads another. */
  model: LoadedModel;
  reasoning: ReasoningSetting;
  config: Config;
  permissions: PermissionGate;
  createToolContext(signal: AbortSignal): ToolContext;
  /** A new engine per sub-agent, so its tokens never count against the main conversation. */
  contextEngine: ContextEngine;
  workingDirectory: string;
  /** The main turn's signal: cancelling the turn cancels the sub-agent. */
  signal: AbortSignal;
  /** Every event of the sub-agent's loop, for nested tool lines and eval metrics. */
  onEvent?(event: AgentEvent): void;
}

export interface ToolCallCounts {
  valid: number;
  repaired: number;
  invalid: number;
}

export interface SubAgentResult {
  summary: string;
  summaryTokens: number;
  /** "limit" when the turn limit (or the invalid-call limit) stopped the work early. */
  endReason: Extract<TurnEndReason, "done" | "limit">;
  truncated: boolean;
  toolCalls: ToolCallCounts;
}

/** Thrown when the sub-agent's loop fails. Cancellation rethrows the signal's reason instead. */
export class SubAgentError extends Error {
  override readonly name = "SubAgentError";
}

type TurnEndEvent = Extract<AgentEvent, { type: "turn-end" }>;

interface SubAgentRun {
  session: SessionState;
  dependencies: AgentDependencies;
  environment: SubAgentEnvironment;
  counts: ToolCallCounts;
}

export async function runSubAgent(
  brief: string,
  tools: readonly ToolDefinition[],
  limits: SubAgentLimits,
  environment: SubAgentEnvironment,
): Promise<SubAgentResult> {
  const run: SubAgentRun = {
    session: freshSession(environment),
    dependencies: subAgentDependencies(tools, limits, environment),
    environment,
    counts: { valid: 0, repaired: 0, invalid: 0 },
  };

  const end = await runOneTurn(run, brief);
  let summary = await finalSummary(run, end.reason, limits);
  const countTokens = (text: string) =>
    environment.lm.countTokens([{ role: "assistant", content: text }]);
  const tokens = await countTokens(summary);
  if (tokens > limits.summaryTokenCap) {
    summary = await askWithoutTools(
      run,
      shortenSummaryRequest(tokens, limits.summaryTokenCap),
      summary,
    );
  }
  const capped = await capSummary(summary, limits.summaryTokenCap, countTokens);
  return {
    summary: capped.text,
    summaryTokens: capped.tokens,
    endReason: end.reason === "done" ? "done" : "limit",
    truncated: capped.truncated,
    toolCalls: run.counts,
  };
}

/** The reply that ended the work, or a no-tools follow-up asking for one. */
async function finalSummary(
  run: SubAgentRun,
  reason: TurnEndReason,
  limits: SubAgentLimits,
): Promise<string> {
  if (reason === "limit") {
    return askWithoutTools(run, turnLimitSummaryRequest(limits.summaryTokenCap), noSummaryText);
  }
  // A turn ends "done" on a reply without tool calls, so the summary is the last message.
  const reply = lastAssistantText(run.session.messages.slice(-1));
  if (reply !== "") return reply;
  return askWithoutTools(run, missingSummaryRequest(limits.summaryTokenCap), noSummaryText);
}

/**
 * One more round with no tools offered, so the reply can only be text. If the model answers
 * with nothing usable, `fallback` stands.
 */
async function askWithoutTools(
  run: SubAgentRun,
  request: string,
  fallback: string,
): Promise<string> {
  const noTools: SubAgentRun = {
    ...run,
    dependencies: {
      ...run.dependencies,
      tools: [],
      config: withRoundLimit(run.dependencies.config, 1),
    },
  };
  const historyLength = run.session.messages.length;
  await runOneTurn(noTools, request);
  const reply = lastAssistantText(run.session.messages.slice(historyLength));
  return reply === "" ? fallback : reply;
}

/** Runs one turn of the sub-agent's loop, forwarding events and counting call validity. */
async function runOneTurn(run: SubAgentRun, input: string): Promise<TurnEndEvent> {
  const { environment } = run;
  let end: TurnEndEvent | undefined;
  for await (const event of runTurn(run.dependencies, run.session, input, environment.signal)) {
    environment.onEvent?.(event);
    if (event.type === "tool-end" && event.validity) run.counts[event.validity] += 1;
    if (event.type === "turn-end") end = event;
  }
  if (!end || end.reason === "cancelled" || environment.signal.aborted) {
    environment.signal.throwIfAborted();
    throw new SubAgentError("The sub-agent was cancelled.");
  }
  if (end.reason === "error") {
    throw new SubAgentError(`The sub-agent failed: ${end.message ?? "unknown error"}`);
  }
  return end;
}

function subAgentDependencies(
  tools: readonly ToolDefinition[],
  limits: SubAgentLimits,
  environment: SubAgentEnvironment,
): AgentDependencies {
  return {
    lm: environment.lm,
    context: environment.contextEngine,
    permissions: new ReadOnlyPermissionGate(environment.permissions),
    tools: readOnlyTools(tools),
    createToolContext: environment.createToolContext,
    config: withRoundLimit(environment.config, limits.turnLimit),
    workingDirectory: environment.workingDirectory,
    extraInstructions: subAgentInstructions(limits.summaryTokenCap),
  };
}

/** The sub-agent's own session: empty history, same model, nothing granted. */
function freshSession(environment: SubAgentEnvironment): SessionState {
  return {
    id: "subagent",
    messages: [],
    model: environment.model,
    permissionMode: "read-only",
    grants: { tools: new Set(), dataFiles: new Set() },
    reasoning: environment.reasoning,
    ephemeral: true,
  };
}

/** The loop counts tool rounds per turn; for a sub-agent that count is its turn limit. */
function withRoundLimit(config: Config, rounds: number): Config {
  return { ...config, agent: { ...config.agent, maxToolRoundsPerTurn: rounds } };
}

function lastAssistantText(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as ChatMessage;
    if (message.role === "assistant" && message.content.trim() !== "") {
      return message.content.trim();
    }
  }
  return "";
}
