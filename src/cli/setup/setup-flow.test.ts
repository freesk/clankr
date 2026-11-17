// The setup flow end to end: scripted answers through the readline prompter, a fake LM
// Studio over HTTP, and a temporary VIX_HOME. The real ~/.vix is never touched.

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configSchema } from "../../config/index.ts";
import { FakeLmStudioServer } from "../../lmstudio/fake-lm-studio-server.test-support.ts";
import { runSetupFlow, type SetupOutcome } from "./setup-flow.ts";
import { TerminalPrompter } from "./terminal-prompter.ts";

const goodToken = "sk-lm-good-secret-9876";
const badToken = "sk-lm-wrong-secret-5555";
const models = [
  { key: "qwen/qwen3-4b", maxContextLength: 32_768 },
  { key: "google/gemma-4-12b-qat", maxContextLength: 131_072 },
];

let scratch: string;
let configFilePath: string;
let server: FakeLmStudioServer;
let baseUrl: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "vix-setup-"));
  configFilePath = join(scratch, "vix-home", "config.json");
  server = new FakeLmStudioServer({ requiredToken: goodToken, models });
  baseUrl = await server.start();
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

interface FlowRun {
  outcome?: SetupOutcome;
  error?: unknown;
  output: string;
}

/** Runs the flow with every answer already typed, as piped input delivers it. */
async function runWithAnswers(
  answers: string[],
  environment: Record<string, string | undefined> = {},
  options: { endInput?: boolean } = {},
): Promise<FlowRun> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  input.write(answers.map((answer) => `${answer}\n`).join(""));
  if (options.endInput !== false) input.end();
  const prompter = new TerminalPrompter({ input, output, terminal: false });
  const run: FlowRun = { output: "" };
  try {
    run.outcome = await runSetupFlow({
      prompter,
      configFilePath,
      environment,
      workingDirectory: "/projects/demo",
      homeDirectory: "/Users/tester",
    });
  } catch (error) {
    run.error = error;
  } finally {
    prompter.close();
  }
  run.output = chunks.join("");
  return run;
}

async function readSaved(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(configFilePath, "utf8"));
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function expectNoSecrets(run: FlowRun): void {
  for (const token of [goodToken, badToken]) {
    expect(run.output).not.toContain(token);
    expect(String(run.error ?? "")).not.toContain(token);
  }
}

describe("setup flow", () => {
  it("writes a valid 0600 config from a fresh start", async () => {
    // URL, token, model 1, context length, permission mode 2, folders, confirm.
    const run = await runWithAnswers([baseUrl, goodToken, "1", "8192", "2", "src, ~/notes", "y"]);
    expect(run.error).toBeUndefined();
    expect(run.outcome?.kind).toBe("saved");
    expect(run.output).toContain("LM Studio accepted the token.");
    expect(run.output).toContain("qwen/qwen3-4b");
    expect(run.output).toContain("sk-…9876 (accepted)");
    expectNoSecrets(run);

    const saved = await readSaved();
    expect(configSchema.safeParse(saved).success).toBe(true);
    expect(saved).toEqual({
      lmStudio: { baseUrl, apiToken: goodToken },
      model: { default: "qwen/qwen3-4b", contextLength: 8192 },
      permissions: {
        mode: "auto-edit",
        allowedRoots: ["/projects/demo/src", "/Users/tester/notes"],
      },
    });
    expect((await stat(configFilePath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(scratch, "vix-home"))).mode & 0o777).toBe(0o700);
    // The token was tested against the models endpoint with the typed token.
    expect(server.requests.at(-1)).toMatchObject({
      path: "/api/v1/models",
      authorization: `Bearer ${goodToken}`,
    });
  });

  it("keeps every existing value on Enter and preserves keys it does not own", async () => {
    const existing = {
      lmStudio: { baseUrl, apiToken: goodToken, allowNonLoopbackHost: false },
      model: {
        default: "google/gemma-4-12b-qat",
        contextLength: 20_000,
        profiles: { "qwen/qwen3-4b": { temperature: 0.2 } },
      },
      permissions: { mode: "read-only", allowedRoots: ["/data"], extraDeniedPaths: ["/secret"] },
      data: { rowCap: 1234 },
    };
    await mkdir(join(scratch, "vix-home"), { recursive: true });
    await writeFile(configFilePath, JSON.stringify(existing));
    const run = await runWithAnswers(["", "", "", "", "", "", ""]);
    expect(run.outcome?.kind).toBe("saved");
    expect(run.output).toContain(`[${baseUrl}]`);
    expect(run.output).toContain("[20,000]");
    expect(run.output).toContain("[read-only]");
    expectNoSecrets(run);
    expect(await readSaved()).toEqual(existing);
  });

  it("reports a rejected token and lets the user retry", async () => {
    const run = await runWithAnswers([baseUrl, badToken, "y", goodToken, "", "", "", "", "y"]);
    expect(run.output).toContain("LM Studio rejected the configured API token.");
    expect(run.output).toContain("LM Studio accepted the token.");
    expectNoSecrets(run);
    expect(await readSaved()).toMatchObject({ lmStudio: { apiToken: goodToken } });
  });

  it("lets the user skip a rejected token, leaving none saved", async () => {
    const run = await runWithAnswers([baseUrl, badToken, "n", "my/model", "", "", "", "y"]);
    expect(run.output).toContain("rejected");
    expect(run.output).toContain("Skipped");
    expectNoSecrets(run);
    const saved = await readSaved();
    expect(saved.lmStudio).toEqual({ baseUrl });
    expect(saved.model).toMatchObject({ default: "my/model" });
  });

  it("falls back to a typed model key when LM Studio is unreachable", async () => {
    const unreachable = "http://127.0.0.1:9";
    const run = await runWithAnswers([unreachable, goodToken, "my/typed-model", "", "", "", "y"]);
    expect(run.output).toContain("LM Studio is not reachable at http://127.0.0.1:9.");
    expect(run.output).toContain("Default model key [google/gemma-4-12b-qat]");
    expect(run.output).toContain("not tested (LM Studio unreachable)");
    expectNoSecrets(run);
    expect(await readSaved()).toMatchObject({
      lmStudio: { baseUrl: unreachable, apiToken: goodToken },
      model: { default: "my/typed-model" },
    });
  });

  it("caps the context length at the model's maximum (D47)", async () => {
    const run = await runWithAnswers([baseUrl, goodToken, "1", "100,000", "", "", "y"]);
    expect(run.output).toContain("qwen/qwen3-4b supports at most 32,768 tokens");
    expect(await readSaved()).toMatchObject({ model: { contextLength: 32_768 } });
  });

  it("re-asks for an invalid URL and warns about a non-loopback host", async () => {
    const run = await runWithAnswers(["not a url", "http://192.0.2.10:1234"], {}, {});
    expect(run.output).toContain("That is not an http(s) address.");
    expect(run.output).toContain("Warning: this host is not a loopback address");
    expect(run.output).toContain("allowNonLoopbackHost");
    expect(run.outcome?.kind).toBe("cancelled");
  });

  it("says when LM_API_TOKEN overrides the saved token", async () => {
    const run = await runWithAnswers([baseUrl, "", "", "", "", "", "y"], {
      LM_API_TOKEN: goodToken,
    });
    expect(run.output).toContain("LM_API_TOKEN is set in your environment");
    expect(run.output).toContain("LM_API_TOKEN is set, and it still overrides");
    expectNoSecrets(run);
    // The environment token is what vix will use, so it is the one tested; it is not saved.
    expect(run.output).toContain("LM Studio answered.");
    expect(await readSaved()).toMatchObject({ lmStudio: { baseUrl } });
    expect((await readSaved()).lmStudio).not.toHaveProperty("apiToken");
  });

  it("writes nothing when the user answers n at the confirmation", async () => {
    const run = await runWithAnswers([baseUrl, goodToken, "", "", "", "", "n"]);
    expect(run.outcome?.kind).toBe("cancelled");
    expect(run.output).toContain("Nothing saved.");
    expect(await exists(configFilePath)).toBe(false);
  });

  it("writes nothing when the input ends part way (Ctrl+D)", async () => {
    const run = await runWithAnswers([baseUrl, goodToken]);
    expect(run.outcome?.kind).toBe("cancelled");
    expect(run.output).toContain("Setup cancelled. Nothing saved.");
    expect(await exists(configFilePath)).toBe(false);
  });

  it("writes nothing on Ctrl+C in a terminal, and never echoes the token", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const prompter = new TerminalPrompter({ input, output, terminal: true });
    const flow = runSetupFlow({
      prompter,
      configFilePath,
      environment: {},
      workingDirectory: "/projects/demo",
    });
    input.write(`${baseUrl}\r`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    input.write(`${goodToken}\r`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    input.write("\x03");
    const outcome = await flow;
    prompter.close();
    expect(outcome.kind).toBe("cancelled");
    expect(chunks.join("")).toContain("LM Studio accepted the token.");
    expect(chunks.join("")).not.toContain(goodToken);
    expect(await exists(configFilePath)).toBe(false);
  });

  it("refuses to overwrite a config file that is not valid JSON", async () => {
    await mkdir(join(scratch, "vix-home"), { recursive: true });
    await writeFile(configFilePath, "{ broken");
    const run = await runWithAnswers([]);
    expect(String(run.error)).toContain("is not valid JSON");
    expect(await readFile(configFilePath, "utf8")).toBe("{ broken");
  });
});
