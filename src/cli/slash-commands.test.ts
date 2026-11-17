import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { SlashCommand, SlashCommandContext } from "../contracts/index.ts";
import { ScriptedLmClient } from "../testing/index.ts";
import { isSlashCommand, SlashCommandDispatcher, splitCommandLine } from "./slash-commands.ts";
import { createFakeHarness } from "./testing/fake-harness.ts";

// The commands CLI-3 names that other parts register.
const registeredNames = ["model", "context", "compact", "think", "permissions"];

function setUp() {
  const calls: { name: string; argumentText: string }[] = [];
  const registered: SlashCommand[] = registeredNames.map((name) => ({
    name,
    summary: `The ${name} command`,
    run: async (argumentText) => {
      calls.push({ name, argumentText });
    },
  }));
  const printed: string[] = [];
  const actions = { exits: 0, newSessions: 0 };
  const dispatcher = new SlashCommandDispatcher(registered, {
    requestExit: () => {
      actions.exits += 1;
    },
    startNewSession: async () => {
      actions.newSessions += 1;
    },
  });
  const context: SlashCommandContext = {
    session: createFakeHarness().session(),
    config: defaultConfig(),
    lm: new ScriptedLmClient(),
    print: (text) => printed.push(text),
  };
  return { dispatcher, context, calls, printed, actions };
}

describe("SlashCommandDispatcher", () => {
  it("dispatches every CLI-3 command to its registered handler", async () => {
    const { dispatcher, context, calls } = setUp();
    for (const name of registeredNames) await dispatcher.dispatch(`/${name} some args`, context);
    expect(calls).toEqual(registeredNames.map((name) => ({ name, argumentText: "some args" })));
  });

  it("handles the cli's own /help, /clear, and /exit", async () => {
    const { dispatcher, context, printed, actions } = setUp();
    await dispatcher.dispatch("/help", context);
    expect(printed[0]).toContain("/model");
    expect(printed[0]).toContain("/exit");
    await dispatcher.dispatch("/clear", context);
    expect(actions.newSessions).toBe(1);
    expect(printed[1]).toBe("Started a new session. The previous one stays saved.");
    await dispatcher.dispatch("/exit", context);
    expect(actions.exits).toBe(1);
    expect(dispatcher.names()).toEqual(["help", "clear", "exit", ...registeredNames]);
  });

  it("prints help for an unknown command", async () => {
    const { dispatcher, context, printed } = setUp();
    await dispatcher.dispatch("/frobnicate", context);
    expect(printed[0]).toMatch(/^Unknown command \/frobnicate\. Commands:\n/);
    expect(printed[0]).toContain("/compact");
  });

  it("rejects a command registered twice", () => {
    const duplicate: SlashCommand = { name: "help", summary: "x", run: async () => {} };
    expect(
      () =>
        new SlashCommandDispatcher([duplicate], {
          requestExit: () => {},
          startNewSession: async () => {},
        }),
    ).toThrow(/registered twice/);
  });

  it("parses command lines", () => {
    expect(isSlashCommand("/model")).toBe(true);
    expect(isSlashCommand("/Users/me/a.png what is this")).toBe(false);
    expect(isSlashCommand("hello /model")).toBe(false);
    expect(splitCommandLine("/Model  qwen/qwen3-8b ")).toEqual({
      name: "model",
      argumentText: "qwen/qwen3-8b",
    });
  });
});
