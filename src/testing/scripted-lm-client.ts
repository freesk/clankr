// An LmClient that replays scripted responses, for testing anything that talks to the model.

import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  LmClient,
  LoadedModel,
  ModelInfo,
} from "../contracts/index.ts";

/** A fixed list of events, or a function that builds them from the request it answers. */
export type ScriptedResponse = ChatEvent[] | ((request: ChatRequest) => ChatEvent[]);

export const testModel: ModelInfo = {
  key: "test/model-12b",
  displayName: "Test Model 12B",
  type: "llm",
  parameterSize: "12B",
  quantization: "Q4_0",
  maxContextLength: 131_072,
  capabilities: { vision: true, trainedForToolUse: true, reasoning: true },
  loadedInstances: [],
};

const charactersPerToken = 4;

export class ScriptedLmClient implements LmClient {
  readonly requests: ChatRequest[] = [];
  readonly loads: { key: string; contextLength: number }[] = [];
  readonly unloads: string[] = [];
  private readonly pending: ScriptedResponse[];
  private readonly models: ModelInfo[];

  constructor(responses: ScriptedResponse[] = [], models: ModelInfo[] = [testModel]) {
    this.pending = [...responses];
    this.models = models;
  }

  /** Queue more responses after construction. */
  enqueue(...responses: ScriptedResponse[]): void {
    this.pending.push(...responses);
  }

  get remainingResponses(): number {
    return this.pending.length;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  async loadModel(key: string, options: { contextLength: number }): Promise<LoadedModel> {
    const model = this.models.find((candidate) => candidate.key === key);
    if (!model) throw new Error(`ScriptedLmClient: unknown model "${key}"`);
    this.loads.push({ key, contextLength: options.contextLength });
    return {
      key,
      instanceId: `${key}:${this.loads.length}`,
      contextLength: options.contextLength,
      capabilities: model.capabilities,
    };
  }

  async unloadModel(instanceId: string): Promise<void> {
    this.unloads.push(instanceId);
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    this.requests.push(request);
    const next = this.pending.shift();
    if (!next) throw new Error("ScriptedLmClient: no scripted response left for this request");
    const events = typeof next === "function" ? next(request) : next;
    for (const event of events) {
      signal.throwIfAborted();
      yield event;
    }
  }

  /** A character-based estimate, deterministic so tests can assert exact numbers. */
  async countTokens(messages: ChatMessage[]): Promise<number> {
    return Math.ceil(messageCharacters(messages) / charactersPerToken);
  }
}

function messageCharacters(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      total += message.content.length;
    } else {
      for (const part of message.content) total += part.type === "text" ? part.text.length : 0;
    }
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? [])
        total += call.name.length + call.argumentsJson.length;
    }
  }
  return total;
}

const usageEvent: ChatEvent = { type: "usage", usage: { promptTokens: 0, completionTokens: 0 } };

/** Builders for common scripted responses. */
export const respond = {
  text(text: string): ChatEvent[] {
    return [{ type: "text", delta: text }, usageEvent, { type: "done", finishReason: "stop" }];
  },

  reasoningThenText(reasoning: string, text: string): ChatEvent[] {
    return [{ type: "reasoning", delta: reasoning }, ...respond.text(text)];
  },

  toolCall(name: string, args: Record<string, unknown>, id = "call_1"): ChatEvent[] {
    return respond.toolCalls([{ name, args, id }]);
  },

  toolCalls(calls: { name: string; args: Record<string, unknown>; id?: string }[]): ChatEvent[] {
    const deltas: ChatEvent[] = calls.map((call, index) => ({
      type: "tool-call-delta",
      index,
      id: call.id ?? `call_${index + 1}`,
      name: call.name,
      argumentsDelta: JSON.stringify(call.args),
    }));
    return [...deltas, usageEvent, { type: "done", finishReason: "tool_calls" }];
  },

  /** A tool call whose arguments are passed through as written, for testing repair and rejection. */
  rawToolCall(name: string, rawArguments: string, id = "call_1"): ChatEvent[] {
    return [
      { type: "tool-call-delta", index: 0, id, name, argumentsDelta: rawArguments },
      usageEvent,
      { type: "done", finishReason: "tool_calls" },
    ];
  },
};
