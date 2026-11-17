// One model call: stream the reply to the user as events, and collect what the loop needs
// afterwards: the text to store and the tool calls to run.

import type {
  AgentEvent,
  ChatRequest,
  ContextEngine,
  LmClient,
  ToolCall,
} from "../contracts/index.ts";
import { ToolCallAssembler } from "./tool-call-assembly.ts";
import { extractToolCallsFromText, ToolCallTextFilter } from "./tool-call-text.ts";

export interface ModelRoundOptions {
  lm: LmClient;
  context: ContextEngine;
  request: ChatRequest;
  /** Prefix for ids of calls that arrive without one, such as calls parsed from text. */
  callIdPrefix: string;
  signal: AbortSignal;
}

export interface ModelReply {
  /** Reply text for history: no reasoning and no tool-call markup. */
  text: string;
  toolCalls: ToolCall[];
  /** True when the signal fired mid-reply. Partial text is kept; partial calls are dropped. */
  cancelled: boolean;
}

/** Yields text and reasoning events while streaming; returns the finished reply. */
export async function* streamModelReply(
  options: ModelRoundOptions,
): AsyncGenerator<AgentEvent, ModelReply> {
  const assembler = new ToolCallAssembler();
  const filter = new ToolCallTextFilter();
  let rawText = "";
  let cancelled = false;

  try {
    for await (const event of options.lm.chat(options.request, options.signal)) {
      if (event.type === "text") {
        rawText += event.delta;
        const visible = filter.push(event.delta);
        if (visible !== "") yield { type: "text", delta: visible };
      } else if (event.type === "reasoning") {
        // Shown to the user, never stored (CTX-7).
        yield { type: "reasoning", delta: event.delta };
      } else if (event.type === "tool-call-delta") {
        assembler.add(event);
      } else if (event.type === "usage") {
        options.context.recordUsage(event.usage);
      }
    }
  } catch (error) {
    if (!options.signal.aborted) throw error;
    cancelled = true;
  }

  const remaining = filter.flush();
  if (remaining !== "" && !cancelled) yield { type: "text", delta: remaining };
  return buildReply(rawText, assembler, options.callIdPrefix, cancelled);
}

function buildReply(
  rawText: string,
  assembler: ToolCallAssembler,
  callIdPrefix: string,
  cancelled: boolean,
): ModelReply {
  const fromText = extractToolCallsFromText(stripReasoningTags(rawText), `${callIdPrefix}_t`);
  if (cancelled) return { text: fromText.text, toolCalls: [], cancelled };
  const nativeCalls = assembler.finish(callIdPrefix);
  // A model given native tools sometimes writes the call as text instead; accept it.
  const toolCalls = nativeCalls.length > 0 ? nativeCalls : fromText.calls;
  return { text: fromText.text, toolCalls, cancelled };
}

/**
 * Some models put their reasoning inline in `<think>` tags instead of a separate channel.
 * It must not reach history either (CTX-7).
 */
export function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
}
