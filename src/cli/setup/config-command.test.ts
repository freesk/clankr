// `clankr config` through runCli, and the first-run offer after a REPL start fails on the token.
// Every run uses a temporary CLANKR_HOME and a fake LM Studio; the real ~/.clankr is never touched.

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLmStudioServer } from "../../lmstudio/fake-lm-studio-server.test-support.ts";
import { createComposition } from "../composition.ts";
import { exitCodes } from "../exit-codes.ts";
import { runCli } from "../run-cli.ts";
import { createFakeComposition, createTestEnvironment } from "../testing/fake-harness.ts";

const token = "sk-lm-first-run-secret-4321";

let scratch: string;
let clankrHome: string;
let server: FakeLmStudioServer;
let baseUrl: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "clankr-config-command-"));
  clankrHome = join(scratch, "home");
  server = new FakeLmStudioServer({ requiredToken: token, models: [{ key: "qwen/qwen3-4b" }] });
  baseUrl = await server.start();
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

const answers = (...lines: string[]) => lines.map((line) => `${line}\n`).join("");

async function writeConfig(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

/** A REPL start whose harness fails, as a missing token makes the real one fail. */
function failingStart(options: { stdinText: string; stdoutIsTerminal: boolean }) {
  const configFilePath = join(clankrHome, "config.json");
  const composition = createFakeComposition({
    configFilePath,
    harness: () => {
      throw new Error("LM Studio requires an API token and none is configured.");
    },
  });
  const environment = createTestEnvironment({
    argv: [],
    composition,
    stdinText: options.stdinText,
    stdinMode: "terminal",
  });
  Object.assign(environment.stdout, { isTTY: options.stdoutIsTerminal });
  return { environment, configFilePath };
}

describe("clankr config", () => {
  it("saves under CLANKR_HOME and never prints the token", async () => {
    const environment = createTestEnvironment({
      argv: ["config"],
      composition: createComposition({ environment: { CLANKR_HOME: clankrHome } }),
      stdinText: answers(baseUrl, token, "1", "", "", "", "y"),
    });
    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(environment.output()).toContain(`Saved ${join(clankrHome, "config.json")}.`);
    expect(environment.output() + environment.errors()).not.toContain(token);
    const saved = JSON.parse(await readFile(join(clankrHome, "config.json"), "utf8"));
    expect(saved.lmStudio).toEqual({ baseUrl, apiToken: token });
    expect((await stat(join(clankrHome, "config.json"))).mode & 0o777).toBe(0o600);
  });

  it("exits 2 when the existing config is invalid", async () => {
    await writeConfig(join(clankrHome, "config.json"), { permissions: { mode: "sometimes" } });
    const environment = createTestEnvironment({
      argv: ["config"],
      composition: createComposition({ environment: { CLANKR_HOME: clankrHome } }),
      stdinText: "",
    });
    expect(await runCli(environment)).toBe(exitCodes.usage);
    expect(environment.errors()).toContain("permissions.mode");
  });
});

describe("first-run offer", () => {
  it("offers the setup on a terminal when the token is missing, and runs it on yes", async () => {
    const { environment, configFilePath } = failingStart({
      stdinText: answers("y", baseUrl, token, "", "", "", "", "y"),
      stdoutIsTerminal: true,
    });
    await writeConfig(configFilePath, { lmStudio: { baseUrl } });
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.errors()).toContain("requires an API token");
    expect(environment.output()).toContain("Run the setup (clankr config) now? [y/N]");
    expect(environment.output()).toContain("Start clankr again to use the new settings.");
    expect(environment.output()).not.toContain(token);
    const saved = JSON.parse(await readFile(configFilePath, "utf8"));
    expect(saved.lmStudio).toEqual({ baseUrl, apiToken: token });
  });

  it("writes nothing when the offer is declined", async () => {
    const { environment, configFilePath } = failingStart({
      stdinText: answers("n"),
      stdoutIsTerminal: true,
    });
    await writeConfig(configFilePath, { lmStudio: { baseUrl } });
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.output()).toContain("Run the setup (clankr config) now?");
    expect(JSON.parse(await readFile(configFilePath, "utf8"))).toEqual({ lmStudio: { baseUrl } });
  });

  it("does not offer when stdout is not a terminal", async () => {
    const { environment, configFilePath } = failingStart({
      stdinText: answers("y"),
      stdoutIsTerminal: false,
    });
    await writeConfig(configFilePath, { lmStudio: { baseUrl } });
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.output()).not.toContain("Run the setup");
    // Not even the classifying request is made.
    expect(server.requests).toHaveLength(0);
  });

  it("does not offer when the failure is not about the token", async () => {
    const { environment, configFilePath } = failingStart({
      stdinText: answers("y"),
      stdoutIsTerminal: true,
    });
    await writeConfig(configFilePath, { lmStudio: { baseUrl, apiToken: token } });
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.output()).not.toContain("Run the setup");
  });

  it("one-shot mode prints the error and a fix naming clankr config, with no offer", async () => {
    await writeConfig(join(clankrHome, "config.json"), { lmStudio: { baseUrl } });
    const environment = createTestEnvironment({
      argv: ["-p", "hello", "--ephemeral"],
      composition: createComposition({ environment: { CLANKR_HOME: clankrHome } }),
    });
    Object.assign(environment.stdout, { isTTY: true });
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.errors()).toContain("requires an API token");
    expect(environment.errors()).toContain("Fix: Create a token in LM Studio");
    expect(environment.errors()).toContain("`clankr config`");
    expect(environment.output()).not.toContain("Run the setup");
  });
});
