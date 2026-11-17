// Per-model profiles (MOD-9) and the load plan for a model (MOD-4, D22).

import type { Config, ModelProfile } from "../config/index.ts";
import type { LoadedInstance, LoadSettings, ModelInfo } from "../contracts/index.ts";

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

/** The global load settings with this model's profile laid over them (D78). */
export function loadSettingsFor(config: Config, key: string): LoadSettings {
  return { ...config.model.load, ...profileFor(config, key)?.load };
}

export type LoadPlan =
  | { action: "reuse"; instance: LoadedInstance }
  | { action: "load" }
  | { action: "reload"; instance: LoadedInstance };

/**
 * What loading a model takes, given what is already loaded. An instance is reused only when
 * its context length and every configured load setting match (D22, D78). A setting LM Studio
 * does not report is not held against the instance.
 */
export function planLoad(
  model: ModelInfo,
  contextLength: number,
  settings: LoadSettings = {},
): LoadPlan {
  const matching = model.loadedInstances.find(
    (instance) =>
      instance.contextLength === contextLength && settingsMatch(instance.settings, settings),
  );
  if (matching) return { action: "reuse", instance: matching };
  const other = model.loadedInstances[0];
  if (other) return { action: "reload", instance: other };
  return { action: "load" };
}

function settingsMatch(loaded: LoadSettings | undefined, wanted: LoadSettings): boolean {
  const keys = Object.keys(wanted) as (keyof LoadSettings)[];
  return keys.every((key) => loaded?.[key] === undefined || loaded[key] === wanted[key]);
}

export function reloadNotice(key: string, instance: LoadedInstance, to: number): string {
  const reason =
    instance.contextLength === to
      ? "with different load settings than clankr is configured for"
      : `with a ${instance.contextLength.toLocaleString("en-US")}-token context and clankr is ` +
        `configured for ${to.toLocaleString("en-US")}`;
  return (
    `Reloading ${key}: it is loaded ${reason}. ` +
    "Anything else using this loaded model is interrupted while it reloads."
  );
}
