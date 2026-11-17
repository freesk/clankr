// Per-model profiles (MOD-9) and the load plan for a model (MOD-4, D22).

import type { Config, ModelProfile } from "../config/index.ts";
import type { LoadedInstance, ModelInfo } from "../contracts/index.ts";

export function profileFor(config: Config, key: string): ModelProfile | undefined {
  return config.model.profiles[key];
}

/**
 * The profile's context length, else the global one, never above what the model supports.
 * A model that does not report its maximum (0) is not capped.
 */
export function contextLengthFor(config: Config, model: ModelInfo): number {
  const configured = profileFor(config, model.key)?.contextLength ?? config.model.contextLength;
  if (model.maxContextLength > 0 && configured > model.maxContextLength) {
    return model.maxContextLength;
  }
  return configured;
}

export type LoadPlan =
  | { action: "reuse"; instance: LoadedInstance }
  | { action: "load" }
  | { action: "reload"; instance: LoadedInstance };

/** What loading a model with a given context length takes, given what is already loaded. */
export function planLoad(model: ModelInfo, contextLength: number): LoadPlan {
  const matching = model.loadedInstances.find(
    (instance) => instance.contextLength === contextLength,
  );
  if (matching) return { action: "reuse", instance: matching };
  const other = model.loadedInstances[0];
  if (other) return { action: "reload", instance: other };
  return { action: "load" };
}

export function reloadNotice(key: string, from: number, to: number): string {
  return (
    `Reloading ${key}: it is loaded with a ${from.toLocaleString("en-US")}-token context ` +
    `and vix is configured for ${to.toLocaleString("en-US")}. ` +
    "Anything else using this loaded model is interrupted while it reloads."
  );
}
