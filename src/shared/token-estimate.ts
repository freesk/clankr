// The character-based token estimate: about four characters per token. Used where no real
// tokenizer can answer (the LM Studio client's fallback, D45) and by the test fakes, so the
// harness has one rule for "estimated tokens" instead of several that drift apart.

import type { ChatMessage } from "../contracts/index.ts";

export const charactersPerToken = 4;

/** Estimated tokens for a list of messages: text content plus tool-call names and arguments. */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  return Math.ceil(messageCharacters(messages) / charactersPerToken);
}

function messageCharacters(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      total += message.content.length;
    } else {
      for (const part of message.content) total += part.type === "text" ? part.text.length : 0;
    }
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        total += call.name.length + call.argumentsJson.length;
      }
    }
  }
  return total;
}
