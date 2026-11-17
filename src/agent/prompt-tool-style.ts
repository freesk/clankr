// The prompt-based tool-calling style (MOD-6). Tools are described in the system prompt
// instead of the API's tools field, and stored history is rewritten into plain user and
// assistant text before sending, because a model without tool training usually has a chat
// template that cannot render tool messages. Stored history keeps the native shape either
// way, so a session can switch style when the model changes.

import type { ChatMessage, ToolCall } from "../contracts/index.ts";
import type { RegisteredTool } from "./registry.ts";
import { toolCallCloseTag, toolCallOpenTag } from "./tool-call-text.ts";
import { toolSignature } from "./tool-schema.ts";

export function promptToolInstructions(tools: readonly RegisteredTool[]): string {
  const lines = tools.map(
    (tool) => `- ${toolSignature(tool.definition)}: ${tool.definition.description}`,
  );
  return [
    "To use a tool, reply with one block per call and nothing after it:",
    `${toolCallOpenTag}{"name": "tool_name", "arguments": {...}}${toolCallCloseTag}`,
    "Results come back in <tool_result> blocks. Answer in plain text when done.",
    "Tools:",
    ...lines,
  ].join("\n");
}

/** Rewrites assistant tool calls and tool messages as text, merging adjacent user turns. */
export function toPromptStyleMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const toolNames = new Map<string, string>();
  const rewritten: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) toolNames.set(call.id, call.name);
      appendMessage(rewritten, { role: "assistant", content: assistantText(message) });
    } else if (message.role === "tool") {
      const name = toolNames.get(message.toolCallId) ?? "tool";
      const content = `<tool_result name="${name}">\n${message.content}\n</tool_result>`;
      appendMessage(rewritten, { role: "user", content });
    } else {
      appendMessage(rewritten, message);
    }
  }
  return rewritten;
}

function assistantText(message: Extract<ChatMessage, { role: "assistant" }>): string {
  const blocks = (message.toolCalls ?? []).map(formatCall);
  return [message.content, ...blocks].filter((part) => part !== "").join("\n");
}

function formatCall(call: ToolCall): string {
  return `${toolCallOpenTag}{"name": ${JSON.stringify(call.name)}, "arguments": ${argumentsText(call)}}${toolCallCloseTag}`;
}

/** Arguments that were not valid JSON are shown as a string, so the block stays parseable. */
function argumentsText(call: ToolCall): string {
  try {
    JSON.parse(call.argumentsJson);
    return call.argumentsJson;
  } catch {
    return JSON.stringify(call.argumentsJson);
  }
}

/** Templates for small models often require strict user/assistant alternation. */
function appendMessage(messages: ChatMessage[], message: ChatMessage): void {
  const previous = messages.at(-1);
  if (previous?.role === "user" && message.role === "user") {
    messages[messages.length - 1] = {
      role: "user",
      content: joinUserContent(previous.content, message.content),
    };
    return;
  }
  messages.push(message);
}

function joinUserContent(
  first: Extract<ChatMessage, { role: "user" }>["content"],
  second: Extract<ChatMessage, { role: "user" }>["content"],
): Extract<ChatMessage, { role: "user" }>["content"] {
  if (typeof first === "string" && typeof second === "string") return `${first}\n\n${second}`;
  const asParts = (content: typeof first) =>
    typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
  return [...asParts(first), ...asParts(second)];
}
