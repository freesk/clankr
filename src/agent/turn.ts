// The turn loop (PRD section 6): prepare messages, call the model, run each tool call,
// repeat until the model answers without a tool call, the turn is cancelled, or a limit hits.

import type {
  AgentEvent,
  ChatMessage,
  Config,
  LoadedModel,
  SessionState,
  ToolCall,
  TurnEndReason,
} from "../contracts/index.ts";
import { cancelledMessage } from "./corrective-errors.ts";
import { type ModelReply, streamModelReply } from "./model-round.ts";
import { ToolRegistry } from "./registry.ts";
import { buildChatRequest, planRound, type RoundPlan, toolSchemasToSend } from "./round-plan.ts";
import { executeToolCall, type ToolCallScope } from "./tool-execution.ts";
import { activateGroupsFromHistory } from "./tool-scope.ts";
import type { AgentDependencies, TurnInput } from "./types.ts";

type TurnEndEvent = Extract<AgentEvent, { type: "turn-end" }>;

/**
 * Runs one user turn and yields its events, ending with exactly one `turn-end`. The
 * session's history is updated in place as the turn goes, and stays well-formed: every
 * tool call gets exactly one tool message, even when the turn is cancelled or fails.
 * Reasoning is never stored (CTX-7).
 */
export async function* runTurn(
  dependencies: AgentDependencies,
  session: SessionState,
  input: TurnInput | string,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent, void> {
  const model = session.model;
  if (!model) {
    yield turnEnd("error", "No model is loaded. Choose one with /model.");
    return;
  }
  session.messages.push(userMessage(typeof input === "string" ? { text: input } : input));

  let end: TurnEndEvent;
  try {
    end = yield* runRounds(dependencies, session, model, signal);
  } catch (error) {
    answerOpenToolCalls(session.messages);
    end = signal.aborted
      ? turnEnd("cancelled")
      : turnEnd("error", error instanceof Error ? error.message : String(error));
  }
  yield end;
}

async function* runRounds(
  dependencies: AgentDependencies,
  session: SessionState,
  model: LoadedModel,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent, TurnEndEvent> {
  const registry = new ToolRegistry(dependencies.tools);
  let consecutiveInvalidCalls = 0;

  for (let round = 1; ; round++) {
    // Checked every round, so a data path in the last tool result switches the group on now.
    activateGroupsFromHistory(session);
    const plan = planRound(dependencies, registry, model, session);
    // History only grows, so its length makes fallback call ids unique within the session.
    const callIdPrefix = `call_${session.messages.length}`;
    const reply = yield* askModel(dependencies, plan, session, model, callIdPrefix, signal);
    recordReply(session.messages, reply);
    if (reply.cancelled) return turnEnd("cancelled");
    if (reply.toolCalls.length === 0) return turnEnd("done");

    const scope: ToolCallScope = { dependencies, offered: offeredByName(plan), signal };
    for (const call of reply.toolCalls) {
      const outcome = yield* executeToolCall(call, scope);
      session.messages.push(outcome.message);
      if (outcome.cancelled || signal.aborted) {
        answerOpenToolCalls(session.messages);
        return turnEnd("cancelled");
      }
      consecutiveInvalidCalls = outcome.validity === "invalid" ? consecutiveInvalidCalls + 1 : 0;
    }

    const limitHit = checkLimits(dependencies.config, round, consecutiveInvalidCalls);
    if (limitHit) return limitHit;
  }
}

async function* askModel(
  dependencies: AgentDependencies,
  plan: RoundPlan,
  session: SessionState,
  model: LoadedModel,
  callIdPrefix: string,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent, ModelReply> {
  const prepared = await dependencies.context.prepareMessages({
    systemPrompt: plan.systemPrompt,
    tools: toolSchemasToSend(plan),
    history: session.messages,
  });
  return yield* streamModelReply({
    lm: dependencies.lm,
    context: dependencies.context,
    request: buildChatRequest(dependencies, model, session, plan, prepared),
    callIdPrefix,
    signal,
  });
}

function offeredByName(plan: RoundPlan): ToolCallScope["offered"] {
  return new Map(plan.tools.map((tool) => [tool.definition.name, tool]));
}

/** Both limits are checked after a round, once every call in it has its result. */
function checkLimits(
  config: Config,
  round: number,
  consecutiveInvalidCalls: number,
): TurnEndEvent | undefined {
  const limits = config.agent;
  if (consecutiveInvalidCalls >= limits.maxConsecutiveInvalidCalls) {
    return turnEnd(
      "limit",
      `Stopped after ${consecutiveInvalidCalls} invalid tool calls in a row. Try rephrasing the request.`,
    );
  }
  if (round >= limits.maxToolRoundsPerTurn) {
    return turnEnd(
      "limit",
      `Stopped after ${round} tool rounds in one turn. Say "continue" to let it go on.`,
    );
  }
  return undefined;
}

function recordReply(history: ChatMessage[], reply: ModelReply): void {
  if (reply.text === "" && reply.toolCalls.length === 0) return;
  const message: ChatMessage = { role: "assistant", content: reply.text };
  if (reply.toolCalls.length > 0) message.toolCalls = reply.toolCalls;
  history.push(message);
}

/** Gives every unanswered call in the last assistant message a "cancelled" result. */
function answerOpenToolCalls(history: ChatMessage[]): void {
  const lastAssistantIndex = history.findLastIndex((message) => message.role === "assistant");
  const lastAssistant = history[lastAssistantIndex];
  if (lastAssistant?.role !== "assistant") return;
  const answered = new Set(
    history
      .slice(lastAssistantIndex + 1)
      .flatMap((message) => (message.role === "tool" ? [message.toolCallId] : [])),
  );
  const unanswered = (lastAssistant.toolCalls ?? []).filter(
    (call: ToolCall) => !answered.has(call.id),
  );
  for (const call of unanswered) {
    history.push({ role: "tool", toolCallId: call.id, content: cancelledMessage });
  }
}

/** Attached paths are listed after the prose, where the data-file check also sees them. */
function userMessage(input: TurnInput): ChatMessage {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return { role: "user", content: input.text };
  const list = attachments.map((attachment) => `- ${attachment.path}`).join("\n");
  return { role: "user", content: `${input.text}\n\nAttached files:\n${list}` };
}

function turnEnd(reason: TurnEndReason, message?: string): TurnEndEvent {
  return message === undefined
    ? { type: "turn-end", reason }
    : { type: "turn-end", reason, message };
}
