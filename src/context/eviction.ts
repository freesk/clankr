// Stale result eviction (PRD section 7.2, technique 5): an old tool result is replaced by a
// one-line stub that keeps its handle, so the full output can still be read back.

import type { ChatMessage, ResultHandle, ResultStore } from "../contracts/index.ts";
import { handlesMentionedIn } from "./handles.ts";
import { toolCallsById, truncateEnd } from "./message-text.ts";

const stubPrefix = "[Evicted";
const argumentsPreviewCharacters = 80;

/** Decides, for the tool message at `index` that is `age` turns old, whether to evict it. */
export type EvictionRule = (index: number, age: number) => boolean;

export function olderThan(turns: number): EvictionRule {
  return (_index, age) => age >= turns;
}

/** Every tool result except the latest round, for when even recent results do not fit. */
export function allButLatestRound(messages: ChatMessage[]): EvictionRule {
  const latestCallIndex = messages.findLastIndex(
    (message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0,
  );
  return (index) => index < latestCallIndex;
}

/**
 * Returns a new list with matching tool results replaced by stubs. Untouched messages are the
 * same objects, and a stub never changes once written, so repeated eviction is stable.
 */
export async function evictToolResults(
  messages: ChatMessage[],
  shouldEvict: EvictionRule,
  results: ResultStore,
): Promise<{ messages: ChatMessage[]; evictedCount: number }> {
  const calls = toolCallsById(messages);
  const ages = turnAges(messages);
  const evicted: ChatMessage[] = [];
  let evictedCount = 0;
  for (const [index, message] of messages.entries()) {
    const evict =
      message.role === "tool" &&
      !isEvictionStub(message.content) &&
      shouldEvict(index, ages[index] ?? 0);
    if (!evict || message.role !== "tool") {
      evicted.push(message);
      continue;
    }
    const call = calls.get(message.toolCallId);
    const handles = await storedHandlesIn(message.content, results);
    const stub = evictionStub(call?.name ?? "tool", call?.argumentsJson ?? "", handles);
    if (stub.length >= message.content.length) {
      evicted.push(message);
      continue;
    }
    evicted.push({ ...message, content: stub });
    evictedCount += 1;
  }
  return { messages: evicted, evictedCount };
}

export function isEvictionStub(content: string): boolean {
  return content.startsWith(stubPrefix);
}

/** Handles mentioned in a text that name a result actually in the store. */
export async function storedHandlesIn(text: string, results: ResultStore): Promise<ResultHandle[]> {
  const stored: ResultHandle[] = [];
  for (const handle of handlesMentionedIn(text)) {
    try {
      await results.describe(handle);
      stored.push(handle);
    } catch {
      // A word that looks like a handle but names nothing, such as "r2" in prose.
    }
  }
  return stored;
}

/** How many turns (user messages) came after each message. */
function turnAges(messages: ChatMessage[]): number[] {
  const ages = new Array<number>(messages.length).fill(0);
  let laterTurns = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    ages[index] = laterTurns;
    if (messages[index]?.role === "user") laterTurns += 1;
  }
  return ages;
}

function evictionStub(tool: string, argumentsJson: string, handles: ResultHandle[]): string {
  const call = `${tool} ${truncateEnd(argumentsJson, argumentsPreviewCharacters)}`.trim();
  if (handles.length === 0) {
    return `${stubPrefix} old result of ${call} to save context. Run it again if needed.]`;
  }
  const where = handles.join(", ");
  return `${stubPrefix} old result of ${call} to save context. Full output: ${where} (read_result).]`;
}
