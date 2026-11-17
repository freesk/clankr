// The LmClient implementation: the only code in the harness that talks to LM Studio.

import type { Config } from "../config/index.ts";
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  LmClient,
  LoadedModel,
  LoadSettings,
  ModelInfo,
} from "../contracts/index.ts";
import { estimateTokens } from "../shared/index.ts";
import { parseChatStream, StreamError } from "./chat-stream.ts";
import { LmStudioError, modelNotDownloaded, requestFailed } from "./errors.ts";
import type { HostResolver } from "./loopback.ts";
import { fetchModels, requestLoad, requestUnload } from "./models-api.ts";
import { planLoad, profileFor } from "./profiles.ts";
import { SdkTokenCounter, type TokenCounter } from "./token-counter.ts";
import { LmStudioTransport } from "./transport.ts";
import { buildChatBody } from "./wire-format.ts";

export interface LmStudioClientOptions {
  config: Config;
  /** Replaces DNS resolution in tests. */
  resolveHost?: HostResolver;
  /** Replaces the SDK-backed counter in tests. */
  tokenCounter?: TokenCounter;
  /** Non-fatal problems, such as falling back to estimated token counts. */
  onWarning?: (text: string) => void;
}

export class LmStudioClient implements LmClient {
  readonly transport: LmStudioTransport;
  private readonly config: Config;
  private readonly tokenCounter: TokenCounter;
  private readonly onWarning: (text: string) => void;
  /** Which model key each instance id belongs to, so profiles apply to chat requests. */
  private readonly instanceKeys = new Map<string, string>();
  private activeInstanceId: string | undefined;
  private warnedAboutEstimates = false;

  constructor(options: LmStudioClientOptions) {
    this.config = options.config;
    this.transport = new LmStudioTransport({
      baseUrl: options.config.lmStudio.baseUrl,
      apiToken: options.config.lmStudio.apiToken,
      allowNonLoopbackHost: options.config.lmStudio.allowNonLoopbackHost,
      ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    });
    this.tokenCounter = options.tokenCounter ?? new SdkTokenCounter(this.transport);
    this.onWarning = options.onWarning ?? (() => {});
  }

  listModels(): Promise<ModelInfo[]> {
    return fetchModels(this.transport);
  }

  /**
   * Makes sure the model is loaded with this context length: reuses a matching instance,
   * reloads one loaded with another length (D22), or loads it fresh.
   */
  async loadModel(
    key: string,
    options: { contextLength: number; settings?: LoadSettings },
  ): Promise<LoadedModel> {
    const models = await this.listModels();
    const model = models.find((candidate) => candidate.key === key);
    if (model?.type !== "llm") {
      throw modelNotDownloaded(key, llmKeys(models));
    }
    const plan = planLoad(model, options.contextLength, options.settings);
    let instanceId: string;
    let contextLength: number;
    if (plan.action === "reuse") {
      instanceId = plan.instance.instanceId;
      contextLength = plan.instance.contextLength;
    } else {
      if (plan.action === "reload") await this.unloadModel(plan.instance.instanceId);
      ({ instanceId, contextLength } = await requestLoad(
        this.transport,
        key,
        options.contextLength,
        options.settings,
      ));
    }
    this.instanceKeys.set(instanceId, key);
    this.activeInstanceId = instanceId;
    return { key, instanceId, contextLength, capabilities: model.capabilities };
  }

  async unloadModel(instanceId: string): Promise<void> {
    await requestUnload(this.transport, instanceId);
    this.instanceKeys.delete(instanceId);
    if (this.activeInstanceId === instanceId) this.activeInstanceId = undefined;
  }

  /** `request.model` is the instance id of the loaded model (LoadedModel.instanceId). */
  async *chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const key = this.instanceKeys.get(request.model) ?? request.model;
    const body = buildChatBody(request, profileFor(this.config, key));
    const stream = await this.transport.postStream("/v1/chat/completions", body, {
      what: "chat",
      signal,
    });
    let sawUsage = false;
    let replyText = "";
    try {
      for await (const event of parseChatStream(stream)) {
        if (event.type === "usage") sawUsage = true;
        if (event.type === "text") replyText += event.delta;
        if (event.type === "done" && !sawUsage) {
          yield await this.countedUsage(request.messages, replyText);
        }
        yield event;
      }
    } catch (error) {
      throw this.chatError(error, signal);
    }
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    if (!this.activeInstanceId) return estimateTokens(messages);
    try {
      return await this.tokenCounter.count(messages, this.activeInstanceId);
    } catch (error) {
      this.warnOnceAboutEstimates(error);
      return estimateTokens(messages);
    }
  }

  /** Closes the SDK connection so the process can exit. */
  async dispose(): Promise<void> {
    await this.tokenCounter.dispose();
  }

  /** The fallback for a stream that reported no usage (specs/lmstudio.md, usage). */
  private async countedUsage(messages: ChatMessage[], replyText: string): Promise<ChatEvent> {
    const promptTokens = await this.countTokens(messages);
    const completionTokens = estimateTokens([{ role: "assistant", content: replyText }]);
    return { type: "usage", usage: { promptTokens, completionTokens } };
  }

  private chatError(error: unknown, signal: AbortSignal): unknown {
    if (signal.aborted || error instanceof LmStudioError) return error;
    const detail = error instanceof StreamError ? error.message : "the stream broke off";
    return requestFailed("chat", this.transport.scrub(detail));
  }

  private warnOnceAboutEstimates(error: unknown): void {
    if (this.warnedAboutEstimates) return;
    this.warnedAboutEstimates = true;
    const reason = error instanceof Error ? this.transport.scrub(error.message) : "unknown error";
    this.onWarning(
      `Token counts are estimated: LM Studio's tokenizer was unavailable (${reason}).`,
    );
  }
}

function llmKeys(models: ModelInfo[]): string[] {
  return models.filter((model) => model.type === "llm").map((model) => model.key);
}
