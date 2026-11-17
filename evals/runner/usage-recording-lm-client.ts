// Wraps any LmClient and counts what the metrics need: prompt tokens sent and
// context overflows. A harness factory hands this wrapper to the product in
// place of the client it wraps.

import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  EmbeddingRequest,
  LmClient,
  LoadedModel,
  ModelInfo,
} from "../../src/contracts/index.ts";
import type { TokenTally } from "./harness.ts";

/** How LM Studio and llama.cpp word a prompt that does not fit the loaded context. */
const contextOverflowPattern =
  /context (length|window|size|overflow)|exceeds? (the )?(context|n_ctx)|n_ctx|too many tokens|prompt is too long/i;

export function isContextOverflowMessage(message: string): boolean {
  return contextOverflowPattern.test(message);
}

export class UsageRecordingLmClient implements LmClient {
  private readonly inner: LmClient;
  private tokensSent = 0;
  private contextOverflows = 0;

  constructor(inner: LmClient) {
    this.inner = inner;
  }

  tally(): TokenTally {
    return { tokensSent: this.tokensSent, contextOverflows: this.contextOverflows };
  }

  listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }

  loadModel(key: string, options: { contextLength: number }): Promise<LoadedModel> {
    return this.inner.loadModel(key, options);
  }

  unloadModel(instanceId: string): Promise<void> {
    return this.inner.unloadModel(instanceId);
  }

  countTokens(messages: ChatMessage[]): Promise<number> {
    return this.inner.countTokens(messages);
  }

  embed(request: EmbeddingRequest, signal: AbortSignal): Promise<number[][]> {
    return this.inner.embed(request, signal);
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    try {
      for await (const event of this.inner.chat(request, signal)) {
        if (event.type === "usage") this.tokensSent += event.usage.promptTokens;
        yield event;
      }
    } catch (error) {
      if (error instanceof Error && isContextOverflowMessage(error.message)) {
        this.contextOverflows++;
      }
      throw error;
    }
  }
}
