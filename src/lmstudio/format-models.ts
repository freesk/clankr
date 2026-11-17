// The MOD-3 model list: name, parameter size, quantization, max context, loaded state,
// and capabilities, one model per line.

import type { ModelInfo } from "../contracts/index.ts";

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function loadedState(model: ModelInfo): string {
  if (model.loadedInstances.length === 0) return "not loaded";
  const lengths = model.loadedInstances.map((instance) => formatCount(instance.contextLength));
  return `loaded (${lengths.join(", ")})`;
}

function capabilityList(model: ModelInfo): string {
  const names: string[] = [];
  if (model.capabilities.vision) names.push("vision");
  if (model.capabilities.trainedForToolUse) names.push("tools");
  if (model.capabilities.reasoning) names.push("reasoning");
  return names.length > 0 ? names.join(" ") : "-";
}

function columnsFor(model: ModelInfo): string[] {
  return [
    model.key,
    model.parameterSize ?? "?",
    model.quantization ?? "?",
    model.maxContextLength > 0 ? `max ${formatCount(model.maxContextLength)}` : "max ?",
    loadedState(model),
    capabilityList(model),
  ];
}

/** Language models only (MOD-3); the current one is marked with an asterisk. */
export function formatModelList(models: ModelInfo[], currentKey: string | undefined): string {
  const llms = models.filter((model) => model.type === "llm");
  if (llms.length === 0) return "No language models are downloaded in LM Studio.";
  const rows = llms.map(columnsFor);
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return llms
    .map((model, index) => {
      const marker = model.key === currentKey ? "*" : " ";
      const cells = rows[index] ?? [];
      const padded = cells.map((cell, column) => cell.padEnd(widths?.[column] ?? 0));
      return `${marker} ${padded.join("  ").trimEnd()}`;
    })
    .join("\n");
}

/** Short label for the interactive picker. */
export function pickerLabel(model: ModelInfo): string {
  const details = [model.parameterSize, model.quantization].filter(Boolean).join(" ");
  return details ? `${model.displayName} (${details})` : model.displayName;
}
