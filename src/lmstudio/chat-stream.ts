// Turns the server-sent events of a streaming `/v1/chat/completions` response into
// ChatEvents. Tool calls are passed through as deltas; the agent loop assembles them.

import type { ChatEvent } from "../contracts/index.ts";

type FinishReason = Extract<ChatEvent, { type: "done" }>["finishReason"];

interface ChunkToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChunkDelta {
  content?: string | null;
  // LM Studio has used both names for separated reasoning text.
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ChunkToolCall[];
}

interface Chunk {
  choices?: { delta?: ChunkDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: unknown;
}

/** Splits a byte stream into the `data:` payloads of server-sent events. */
export async function* readSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice("data:".length).trim();
        newline = buffered.indexOf("\n");
      }
    }
    const last = buffered.trim();
    if (last.startsWith("data:")) yield last.slice("data:".length).trim();
  } finally {
    // Closes the HTTP stream when the consumer stops early, so LM Studio stops generating.
    await reader.cancel().catch(() => {});
  }
}

/** Raised when the stream carries an error object instead of a chunk. */
export class StreamError extends Error {
  override readonly name = "StreamError";
}

export async function* parseChatStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent> {
  let finishReason: FinishReason | undefined;
  for await (const data of readSseData(stream)) {
    if (data === "[DONE]") break;
    const chunk = parseChunk(data);
    if (!chunk) continue;
    if (chunk.error !== undefined) throw new StreamError(describeStreamError(chunk.error));
    for (const choice of chunk.choices ?? []) {
      if (choice.delta) yield* eventsFromDelta(choice.delta);
      if (choice.finish_reason) finishReason = toFinishReason(choice.finish_reason);
    }
    if (chunk.usage) {
      yield {
        type: "usage",
        usage: {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        },
      };
    }
  }
  yield { type: "done", finishReason: finishReason ?? "other" };
}

function parseChunk(data: string): Chunk | undefined {
  try {
    return JSON.parse(data) as Chunk;
  } catch {
    return undefined;
  }
}

/**
 * Gemma 4 opens its reasoning with `<|channel>thought` and closes it with `<channel|>`.
 * LM Studio usually removes them, but on some turns they reach the reasoning text.
 */
const channelMarkers = /<\|channel>(?:thought)?|<channel\|>/g;

function* eventsFromDelta(delta: ChunkDelta): Generator<ChatEvent> {
  const reasoning = (delta.reasoning_content ?? delta.reasoning)?.replace(channelMarkers, "");
  if (reasoning) yield { type: "reasoning", delta: reasoning };
  if (delta.content) yield { type: "text", delta: delta.content };
  for (const [position, call] of (delta.tool_calls ?? []).entries()) {
    const event: ChatEvent = { type: "tool-call-delta", index: call.index ?? position };
    if (call.id) event.id = call.id;
    if (call.function?.name) event.name = call.function.name;
    if (call.function?.arguments) event.argumentsDelta = call.function.arguments;
    yield event;
  }
}

function toFinishReason(reason: string): FinishReason {
  if (reason === "stop" || reason === "tool_calls" || reason === "length") return reason;
  return "other";
}

function describeStreamError(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "the stream reported an error";
}
