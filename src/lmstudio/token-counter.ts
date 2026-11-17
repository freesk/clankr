// Token counting with the loaded model's own tokenizer and prompt template, through
// `@lmstudio/sdk` (PRD section 6.1). Usage reported by a chat response remains the source
// of truth after each call; this count is for deciding what to send before the call.

import type { ChatMessage } from "../contracts/index.ts";
import type { LmStudioTransport } from "./transport.ts";

export interface TokenCounter {
  /** Counts the prompt the model would see for these messages, template included. */
  count(messages: ChatMessage[], instanceId: string): Promise<number>;
  dispose(): Promise<void>;
}

// The SDK is only typed here, never imported eagerly: it costs ~50 ms and opens a WebSocket.
type SdkModule = typeof import("@lmstudio/sdk");
type SdkClient = InstanceType<SdkModule["LMStudioClient"]>;
type SdkHistory = import("@lmstudio/sdk").ChatHistoryData;
type SdkMessage = SdkHistory["messages"][number];

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

export class SdkTokenCounter implements TokenCounter {
  private client: Promise<SdkClient> | undefined;

  private readonly transport: LmStudioTransport;

  constructor(transport: LmStudioTransport) {
    this.transport = transport;
  }

  async count(messages: ChatMessage[], instanceId: string): Promise<number> {
    const client = await this.connect();
    const loaded = await client.llm.listLoaded();
    const model = loaded.find((candidate) => candidate.identifier === instanceId);
    // Never call `client.llm.model(key)` here: it would load a model as a side effect.
    if (!model) throw new Error(`model instance ${instanceId} is not loaded`);
    const prompt = await model.applyPromptTemplate(toSdkHistory(closeTrailingToolCalls(messages)));
    return model.countTokens(prompt);
  }

  async dispose(): Promise<void> {
    const pending = this.client;
    this.client = undefined;
    if (pending) await (await pending)[Symbol.asyncDispose]().catch(() => {});
  }

  private connect(): Promise<SdkClient> {
    if (!this.client) {
      this.client = this.createClient();
      this.client.catch(() => {
        this.client = undefined;
      });
    }
    return this.client;
  }

  private async createClient(): Promise<SdkClient> {
    // The SDK opens its own connection, so it passes the same host check as HTTP (SEC-1).
    await this.transport.ensureHostAllowed();
    const { LMStudioClient } = await import("@lmstudio/sdk");
    const token = this.transport.tokenForSdk();
    return new LMStudioClient({
      baseUrl: toWebSocketUrl(this.transport.baseUrl),
      // Silent, so nothing the SDK logs can carry the token to the terminal.
      logger: silentLogger,
      ...(token ? { apiToken: token } : {}),
    });
  }
}

export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/+$/, "");
}

/**
 * Chat templates refuse to render a history that ends with an assistant message holding
 * tool calls ("Cannot continue an assistant message that contains tool calls"), and the
 * context ledger counts messages one at a time. Answering each call with an empty result
 * makes the history renderable; the few extra tokens over-count, which is the safe side.
 */
export function closeTrailingToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.toolCalls?.length) return messages;
  const emptyResults: ChatMessage[] = last.toolCalls.map((call) => ({
    role: "tool",
    toolCallId: call.id,
    content: "",
  }));
  return [...messages, ...emptyResults];
}

/** Images are left out: their token cost is model-specific and corrected by usage afterwards. */
export function toSdkHistory(messages: ChatMessage[]): SdkHistory {
  return { messages: messages.map(toSdkMessage) };
}

function toSdkMessage(message: ChatMessage): SdkMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: [{ type: "text", text: message.content }] };
    case "user":
      return { role: "user", content: [{ type: "text", text: userText(message.content) }] };
    case "assistant":
      return {
        role: "assistant",
        content: [
          { type: "text", text: message.content },
          ...(message.toolCalls ?? []).map((call) => ({
            type: "toolCallRequest" as const,
            toolCallRequest: {
              type: "function" as const,
              id: call.id,
              name: call.name,
              arguments: parseArguments(call.argumentsJson),
            },
          })),
        ],
      };
    case "tool":
      return {
        role: "tool",
        content: [
          { type: "toolCallResult", toolCallId: message.toolCallId, content: message.content },
        ],
      };
  }
}

function userText(content: Extract<ChatMessage, { role: "user" }>["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function parseArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
