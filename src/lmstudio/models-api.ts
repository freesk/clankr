// LM Studio's native model endpoints (PRD section 6.1): list, load, unload.
// Parsing is lenient: unknown fields are ignored and optional ones may be missing,
// so a small API change degrades a field instead of breaking the session.

import { z } from "zod";
import type { LoadedInstance, ModelCapabilities, ModelInfo } from "../contracts/index.ts";
import { modelLoadFailed, requestFailed } from "./errors.ts";
import type { LmStudioTransport } from "./transport.ts";

const loadedInstanceSchema = z.object({
  id: z.string(),
  config: z.object({ context_length: z.number().optional() }).optional(),
});

const modelEntrySchema = z.object({
  key: z.string(),
  display_name: z.string().optional(),
  type: z.string(),
  params_string: z.string().nullish(),
  quantization: z.union([z.string(), z.object({ name: z.string().nullish() })]).nullish(),
  max_context_length: z.number().optional(),
  // `reasoning` has been reported both as a flag and as an object of options.
  capabilities: z
    .object({
      vision: z.boolean().optional(),
      trained_for_tool_use: z.boolean().optional(),
      reasoning: z.unknown().optional(),
    })
    .optional(),
  loaded_instances: z.array(loadedInstanceSchema).optional(),
});

const modelListSchema = z.object({ models: z.array(z.unknown()) });

const loadResponseSchema = z.object({
  instance_id: z.string(),
  load_config: z.object({ context_length: z.number().optional() }).optional(),
});

type ModelEntry = z.infer<typeof modelEntrySchema>;

/** Downloaded models of every type. Entries that do not parse are skipped, not fatal. */
export async function fetchModels(transport: LmStudioTransport): Promise<ModelInfo[]> {
  const body = await transport.getJson("/api/v1/models", { what: "listing models" });
  const list = modelListSchema.safeParse(body);
  if (!list.success) throw requestFailed("listing models", "unexpected response shape");
  const models: ModelInfo[] = [];
  for (const raw of list.data.models) {
    const entry = modelEntrySchema.safeParse(raw);
    if (entry.success) models.push(toModelInfo(entry.data));
  }
  return models;
}

function toModelInfo(entry: ModelEntry): ModelInfo {
  return {
    key: entry.key,
    displayName: entry.display_name ?? entry.key,
    type: entry.type === "embedding" ? "embedding" : "llm",
    parameterSize: entry.params_string ?? undefined,
    quantization: quantizationName(entry.quantization),
    maxContextLength: entry.max_context_length ?? 0,
    capabilities: toCapabilities(entry.capabilities),
    loadedInstances: (entry.loaded_instances ?? []).map(toLoadedInstance),
  };
}

function quantizationName(quantization: ModelEntry["quantization"]): string | undefined {
  if (typeof quantization === "string") return quantization;
  return quantization?.name ?? undefined;
}

function toCapabilities(capabilities: ModelEntry["capabilities"]): ModelCapabilities {
  return {
    vision: capabilities?.vision ?? false,
    trainedForToolUse: capabilities?.trained_for_tool_use ?? false,
    reasoning: Boolean(capabilities?.reasoning),
  };
}

function toLoadedInstance(instance: z.infer<typeof loadedInstanceSchema>): LoadedInstance {
  return { instanceId: instance.id, contextLength: instance.config?.context_length ?? 0 };
}

export interface LoadResult {
  instanceId: string;
  contextLength: number;
}

export async function requestLoad(
  transport: LmStudioTransport,
  key: string,
  contextLength: number,
): Promise<LoadResult> {
  const body = await transport.postJson(
    "/api/v1/models/load",
    { model: key, context_length: contextLength, echo_load_config: true },
    { what: "loading a model", onHttpError: (_status, detail) => modelLoadFailed(key, detail) },
  );
  const parsed = loadResponseSchema.safeParse(body);
  if (!parsed.success) throw modelLoadFailed(key, "LM Studio returned an unexpected response");
  return {
    instanceId: parsed.data.instance_id,
    contextLength: parsed.data.load_config?.context_length ?? contextLength,
  };
}

export async function requestUnload(
  transport: LmStudioTransport,
  instanceId: string,
): Promise<void> {
  await transport.postJson(
    "/api/v1/models/unload",
    { instance_id: instanceId },
    { what: "unloading a model" },
  );
}
