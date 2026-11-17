// `/think` (CTX-7, CLI-3): turn the model's reasoning on or off for this session. The next
// request carries the setting; the LM Studio client sends it. Reasoning text is never kept
// in history either way.

import type { ReasoningSetting, SlashCommand } from "../contracts/index.ts";

export const thinkCommand: SlashCommand = {
  name: "think",
  summary: "Turn the model's reasoning on or off",
  usage: "/think [on|off]",
  async run(argumentText, context) {
    const requested = parseSetting(argumentText);
    if (requested === "invalid") {
      context.print(`Usage: /think [on|off]. Reasoning is ${context.session.reasoning}.`);
      return;
    }
    // No argument toggles, which is the quickest way to switch for one routing-heavy task.
    const next = requested ?? (context.session.reasoning === "on" ? "off" : "on");
    context.session.reasoning = next;
    context.print(`Reasoning is ${next}.`);
    if (next === "on" && context.session.model?.capabilities.reasoning === false) {
      context.print("The current model does not report reasoning support, so this may do nothing.");
    }
  },
};

function parseSetting(argumentText: string): ReasoningSetting | undefined | "invalid" {
  const word = argumentText.trim().toLowerCase();
  if (word === "") return undefined;
  if (word === "on" || word === "off") return word;
  return "invalid";
}
