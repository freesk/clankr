// Maps the harness's own chat types to the OpenAI-compatible wire format, so no other
// part depends on that format (see src/contracts/model.ts).

import type { ModelProfile } from "../config/index.ts";
import type {
  ChatMessage,
  ChatRequest,
  ReasoningSetting,
  SamplingParameters,
  ToolSchema,
  UserContentPart,
} from "../contracts/index.ts";

type WireContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | WireContentPart[] }
  | { role: "assistant"; content: string; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function toWireMessage(message: ChatMessage): WireMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: toWireUserContent(message.content) };
    case "assistant":
      return toWireAssistant(message);
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
}

function toWireUserContent(content: string | UserContentPart[]): string | WireContentPart[] {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` },
        },
  );
}

function toWireAssistant(message: Extract<ChatMessage, { role: "assistant" }>): WireMessage {
  if (!message.toolCalls || message.toolCalls.length === 0) {
    return { role: "assistant", content: message.content };
  }
  return {
    role: "assistant",
    content: message.content,
    tool_calls: message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.argumentsJson },
    })),
  };
}

function toWireTool(tool: ToolSchema) {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/**
 * CTX-7. The OpenAI-compatible endpoint takes `reasoning_effort`; "none" turns reasoning off.
 * Not yet confirmed against a live server (specs/lmstudio.md, open issues).
 */
function reasoningFields(setting: ReasoningSetting | undefined): Record<string, string> {
  if (setting === "off") return { reasoning_effort: "none" };
  if (setting === "on") return { reasoning_effort: "medium" };
  return {};
}

/**
 * The request body for a streaming `/v1/chat/completions` call. Values in the request
 * win over the model's profile (MOD-9); the profile fills what the request leaves out.
 */
export function buildChatBody(
  request: ChatRequest,
  profile: ModelProfile | undefined,
): Record<string, unknown> {
  const sampling = mergeSampling(profile, request.sampling);
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toWireMessage),
    stream: true,
    // Asks for a final chunk with token usage, the source of truth for counts.
    stream_options: { include_usage: true },
    ...reasoningFields(request.reasoning ?? profile?.reasoning),
  };
  if (request.tools && request.tools.length > 0) body.tools = request.tools.map(toWireTool);
  if (sampling.temperature !== undefined) body.temperature = sampling.temperature;
  if (sampling.topP !== undefined) body.top_p = sampling.topP;
  if (sampling.topK !== undefined) body.top_k = sampling.topK;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  return body;
}

function mergeSampling(
  profile: ModelProfile | undefined,
  requested: SamplingParameters | undefined,
): SamplingParameters {
  return {
    temperature: requested?.temperature ?? profile?.temperature,
    topK: requested?.topK ?? profile?.topK,
    topP: requested?.topP ?? profile?.topP,
  };
}
