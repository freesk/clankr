import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { SlashCommandContext } from "../contracts/index.ts";
import { createTestSession, ScriptedLmClient } from "../testing/index.ts";
import { thinkCommand } from "./think-command.ts";

function commandContext(reasoningCapable = true) {
  const printed: string[] = [];
  const context: SlashCommandContext = {
    session: createTestSession({ reasoning: reasoningCapable }),
    config: defaultConfig(),
    lm: new ScriptedLmClient(),
    print: (text) => printed.push(text),
  };
  return { context, printed };
}

describe("/think", () => {
  it("sets reasoning on or off explicitly", async () => {
    const { context, printed } = commandContext();
    await thinkCommand.run("off", context);
    expect(context.session.reasoning).toBe("off");
    await thinkCommand.run(" ON ", context);
    expect(context.session.reasoning).toBe("on");
    expect(printed).toEqual(["Reasoning is off.", "Reasoning is on."]);
  });

  it("toggles with no argument", async () => {
    const { context } = commandContext();
    await thinkCommand.run("", context);
    expect(context.session.reasoning).toBe("off");
  });

  it("explains usage for a bad argument and changes nothing", async () => {
    const { context, printed } = commandContext();
    await thinkCommand.run("maybe", context);
    expect(context.session.reasoning).toBe("on");
    expect(printed[0]).toContain("Usage: /think [on|off]");
  });

  it("warns when the model does not report reasoning", async () => {
    const { context, printed } = commandContext(false);
    context.session.reasoning = "off";
    await thinkCommand.run("on", context);
    expect(printed[1]).toContain("does not report reasoning");
  });
});
