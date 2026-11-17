// `/config` inside the REPL: the same flow, answered on the input line, then the permission
// mode applies to the running session. Driven through the controller, without Ink.

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLmStudioServer } from "../../lmstudio/fake-lm-studio-server.test-support.ts";
import { ReplController } from "../repl/controller.ts";
import type { KeyPress, ReplState } from "../repl/repl-state.ts";
import { createFakeHarness } from "../testing/fake-harness.ts";
import { createConfigCommand } from "./config-command.ts";

const token = "sk-lm-repl-secret-2468";

let scratch: string;
let server: FakeLmStudioServer;
let baseUrl: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "clankr-config-slash-"));
  server = new FakeLmStudioServer({ requiredToken: token, models: [{ key: "qwen/qwen3-4b" }] });
  baseUrl = await server.start();
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

const noKey: KeyPress = {
  ctrl: false,
  meta: false,
  return: false,
  escape: false,
  backspace: false,
  delete: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  tab: false,
};

function typeLine(controller: ReplController, text: string): void {
  for (const character of text) controller.handleKey(character, noKey);
  controller.handleKey("", { ...noKey, return: true });
}

function waitFor(controller: ReplController, predicate: (state: ReplState) => boolean) {
  return new Promise<ReplState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitFor timed out")), 3_000);
    const check = () => {
      const state = controller.getState();
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    };
    const unsubscribe = controller.subscribe(check);
    check();
  });
}

function setUp() {
  const configFilePath = join(scratch, "home", "config.json");
  const harness = createFakeHarness();
  const controller = new ReplController({
    harness,
    workingDirectory: "/work",
    cliCommands: [
      createConfigCommand({ configFilePath, environment: {}, workingDirectory: "/work" }),
    ],
  });
  return { harness, controller, configFilePath };
}

/** Waits for the next question, then types the answer. Returns the question asked. */
async function answer(controller: ReplController, text: string) {
  const state = await waitFor(controller, (current) => current.question !== undefined);
  typeLine(controller, text);
  return state.question;
}

const entryText = (state: ReplState) => state.entries.map((entry) => entry.text).join("\n");

describe("/config in the REPL", () => {
  it("asks on the input line, masks the token, saves, and applies the permission mode", async () => {
    const { harness, controller, configFilePath } = setUp();
    typeLine(controller, "/config");
    await answer(controller, baseUrl);
    const tokenQuestion = await answer(controller, token);
    expect(tokenQuestion?.secret).toBe(true);
    await answer(controller, "1");
    await answer(controller, "");
    await answer(controller, "read-only");
    await answer(controller, "");
    await answer(controller, "y");
    const state = await waitFor(controller, (current) => !current.busy);

    expect(harness.session().permissionMode).toBe("read-only");
    const text = entryText(state);
    expect(text).toContain("Settings (hidden; Enter for none): (hidden)");
    expect(text).toContain("Permission mode is now read-only.");
    expect(text).toContain("Restart clankr to use the new base URL, API token, default model.");
    expect(text).toContain("Use /model to switch models now.");
    expect(text).not.toContain(token);
    const saved = JSON.parse(await readFile(configFilePath, "utf8"));
    expect(saved.lmStudio).toEqual({ baseUrl, apiToken: token });
    expect((await stat(configFilePath)).mode & 0o777).toBe(0o600);
  });

  it("cancels on Ctrl+C and writes nothing", async () => {
    const { harness, controller, configFilePath } = setUp();
    typeLine(controller, "/config");
    await answer(controller, baseUrl);
    await waitFor(controller, (current) => current.question !== undefined);
    controller.handleKey("c", { ...noKey, ctrl: true });
    const state = await waitFor(controller, (current) => !current.busy);
    expect(entryText(state)).toContain("Setup cancelled. Nothing saved.");
    expect(harness.session().permissionMode).toBe("ask");
    await expect(stat(configFilePath)).rejects.toThrow();
  });
});
