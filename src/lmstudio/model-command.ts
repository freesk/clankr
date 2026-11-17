// The `/model` slash command: list models (MOD-3), pick one, or `/model <key>` to switch (MOD-4).

import type { SlashCommand, SlashCommandContext } from "../contracts/index.ts";
import { LmStudioError } from "./errors.ts";
import { formatModelList, pickerLabel } from "./format-models.ts";
import type { ModelSwitcher } from "./model-switcher.ts";

export function createModelCommand(switcher: ModelSwitcher): SlashCommand {
  return {
    name: "model",
    summary: "List models, or switch to another one",
    usage: "/model [key]",
    async run(argumentText, context) {
      try {
        const key = argumentText.trim();
        if (key) await switchAndReport(switcher, key, context);
        else await listAndPick(switcher, context);
      } catch (error) {
        // Typed errors are for the user, with their fix; anything else is a bug and propagates.
        if (error instanceof LmStudioError) context.print(error.describe());
        else throw error;
      }
    },
  };
}

async function listAndPick(switcher: ModelSwitcher, context: SlashCommandContext) {
  const models = await switcher.lm.listModels();
  context.print(formatModelList(models, context.session.model?.key));
  if (!context.choose) return;
  const options = models
    .filter((model) => model.type === "llm")
    .map((model) => ({ label: pickerLabel(model), value: model.key }));
  if (options.length === 0) return;
  const chosen = await context.choose("Switch to which model?", options);
  if (chosen) await switchAndReport(switcher, chosen, context);
}

async function switchAndReport(switcher: ModelSwitcher, key: string, context: SlashCommandContext) {
  const before = context.session.model;
  const model = await switcher.switchTo(key, context.session, context.print);
  if (model === before) {
    context.print(`Already using ${model.key}.`);
    return;
  }
  context.print(
    `Switched to ${model.key} with a ${model.contextLength.toLocaleString("en-US")}-token context.`,
  );
}
