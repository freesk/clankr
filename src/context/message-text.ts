// Small helpers for reading and rewriting chat messages without caring about their content shape.

import type { ChatMessage, ToolCall } from "../contracts/index.ts";

/** The text of a message. Image parts carry no text and are skipped. */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

/** A copy of the message with its text replaced. Images in a user message are dropped. */
export function withText(message: ChatMessage, text: string): ChatMessage {
  return { ...message, content: text } as ChatMessage;
}

/** Puts a note in front of a user message, keeping any images it carries. */
export function prependToUserMessage(message: ChatMessage, note: string): ChatMessage {
  if (message.role !== "user") return message;
  if (typeof message.content === "string") {
    return { role: "user", content: `${note}\n\n${message.content}` };
  }
  return { role: "user", content: [{ type: "text", text: note }, ...message.content] };
}

/** Keeps the start and end of a text and marks the cut. */
export function truncateMiddle(text: string, maximumCharacters: number): string {
  if (text.length <= maximumCharacters) return text;
  const marker = "\n[… cut to fit the context window …]\n";
  const keep = Math.max(maximumCharacters - marker.length, 0);
  const headLength = Math.ceil(keep / 2);
  return text.slice(0, headLength) + marker + text.slice(text.length - (keep - headLength));
}

export function truncateEnd(text: string, maximumCharacters: number): string {
  return text.length <= maximumCharacters ? text : `${text.slice(0, maximumCharacters - 1)}…`;
}

/** Index of every user message: each one starts a turn. */
export function turnStartIndexes(messages: ChatMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") starts.push(index);
  });
  return starts;
}

/** The tool call each tool message answers, by call id. */
export function toolCallsById(messages: ChatMessage[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) calls.set(call.id, call);
  }
  return calls;
}
