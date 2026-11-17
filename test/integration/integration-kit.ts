// Runs the real parts together, in process, against a scripted model. Everything on disk
// lives in a fresh temporary folder: a private VIX_HOME, a fake home folder, and a working
// folder. `delete` and `/undo` use a private Trash (D54), so nothing reaches the real one.

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainLmConnection } from "../../src/app/lm-connection.ts";
import { createComposition } from "../../src/cli/composition.ts";
import type { CliComposition } from "../../src/cli/harness.ts";
import { runCli } from "../../src/cli/run-cli.ts";
import { createTestEnvironment } from "../../src/cli/testing/fake-harness.ts";
import type { ConfigInput } from "../../src/config/index.ts";
import type { ModelInfo } from "../../src/contracts/index.ts";
import { ScriptedLmClient, type ScriptedResponse, testModel } from "../../src/testing/index.ts";

export interface IntegrationKit {
  lm: ScriptedLmClient;
  composition: CliComposition;
  vixHome: string;
  workingDirectory: string;
  /** Paths the private Trash received. */
  trashed: string[];
  /** Runs `vix <argv>` in the working folder and returns what it printed. */
  run(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Every file under VIX_HOME, relative to it. */
  filesUnderVixHome(): Promise<string[]>;
  cleanup(): Promise<void>;
}

export interface IntegrationKitOptions {
  responses?: ScriptedResponse[];
  models?: ModelInfo[];
  config?: ConfigInput;
}

export async function createIntegrationKit(
  options: IntegrationKitOptions = {},
): Promise<IntegrationKit> {
  const scratch = await mkdtemp(join(tmpdir(), "vix-integration-"));
  const vixHome = join(scratch, "vix-home");
  const homeDirectory = join(scratch, "home");
  const workingDirectory = join(scratch, "work");
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(workingDirectory, { recursive: true });
  const models = options.models ?? [testModel];
  const config: ConfigInput = { model: { default: models[0]?.key }, ...options.config };
  await mkdir(vixHome, { recursive: true });
  await writeFile(join(vixHome, "config.json"), JSON.stringify(config));

  const lm = new ScriptedLmClient(options.responses ?? [], models);
  const trashed: string[] = [];
  const composition = createComposition({
    environment: { VIX_HOME: vixHome },
    homeDirectory,
    createLmConnection: async () => plainLmConnection(lm),
    fileTools: {
      trash: async (paths) => {
        trashed.push(...paths);
        for (const path of paths) await rm(path, { recursive: true, force: true });
      },
    },
  });

  return {
    lm,
    composition,
    vixHome,
    workingDirectory,
    trashed,
    async run(argv) {
      const environment = createTestEnvironment({ argv, composition });
      environment.workingDirectory = workingDirectory;
      const exitCode = await runCli(environment);
      return { exitCode, stdout: environment.output(), stderr: environment.errors() };
    },
    filesUnderVixHome: () => listFiles(vixHome, ""),
    cleanup: () => rm(scratch, { recursive: true, force: true }),
  };
}

async function listFiles(directory: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(join(directory, entry.name), relative)));
    else files.push(relative);
  }
  return files;
}

/** The text of the newest tool message in a request, where the model finds handles. */
export function lastToolResult(messages: { role: string; content: unknown }[]): string {
  const message = messages.findLast((candidate) => candidate.role === "tool");
  return typeof message?.content === "string" ? message.content : "";
}
