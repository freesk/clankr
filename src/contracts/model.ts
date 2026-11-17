// Talking to the model (seam: lmstudio → agent-loop, context, image, cli).
// Messages use the harness's own shape; the LM Studio client maps them to the
// OpenAI-compatible wire format, so no other part depends on that format.

export interface ModelCapabilities {
  vision: boolean;
  trainedForToolUse: boolean;
  reasoning: boolean;
}

/** Load settings beyond the context length (D78). Unset means LM Studio decides. */
export interface LoadSettings {
  parallel?: number;
  flashAttention?: boolean;
  offloadKvCacheToGpu?: boolean;
  evalBatchSize?: number;
}

export interface LoadedInstance {
  instanceId: string;
  contextLength: number;
  /** What LM Studio reports the instance was loaded with. */
  settings?: LoadSettings;
}

/** One entry from `GET /api/v1/models` (MOD-3). */
export interface ModelInfo {
  key: string;
  displayName: string;
  type: "llm" | "embedding";
  /** As LM Studio reports it, for example "12B". */
  parameterSize?: string;
  quantization?: string;
  maxContextLength: number;
  capabilities: ModelCapabilities;
  loadedInstances: LoadedInstance[];
}

/** The model the session is talking to, loaded with a known context length. */
export interface LoadedModel {
  key: string;
  instanceId: string;
  contextLength: number;
  capabilities: ModelCapabilities;
}

export type ModelChangedListener = (model: LoadedModel) => void | Promise<void>;

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text as the model wrote it. The agent loop repairs and validates it. */
  argumentsJson: string;
}

export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: "image/jpeg" | "image/png" | "image/webp"; dataBase64: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** A tool as the model sees it: the JSON schema generated from the zod parameters. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ReasoningSetting = "on" | "off";

export interface SamplingParameters {
  temperature?: number;
  topK?: number;
  topP?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  reasoning?: ReasoningSetting;
  sampling?: SamplingParameters;
  maxTokens?: number;
}

/** Texts to turn into vectors with an embedding model (SRCH-9). */
export interface EmbeddingRequest {
  /** The embedding model's key, as `GET /api/v1/models` reports it. */
  model: string;
  inputs: string[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Streamed chat events. Tool calls arrive as deltas keyed by index; the agent
 * loop assembles them, the client does not interpret them.
 */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | {
      type: "tool-call-delta";
      index: number;
      id?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" | "other" };

export interface LmClient {
  listModels(): Promise<ModelInfo[]>;
  loadModel(
    key: string,
    options: { contextLength: number; settings?: LoadSettings },
  ): Promise<LoadedModel>;
  unloadModel(instanceId: string): Promise<void>;
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
  countTokens(messages: ChatMessage[]): Promise<number>;
  /** One vector per input, in input order, all of the same length. */
  embed(request: EmbeddingRequest, signal: AbortSignal): Promise<number[][]>;
}
