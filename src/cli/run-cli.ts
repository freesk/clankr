// Picks what `vix` does from its arguments. Ink is loaded only when the REPL starts
// (CLAUDE.md rule 7), so `-p`, `wipe`, `--help`, and `--version` never pay for it.

import { createInterface } from "node:readline/promises";
import { ConfigError } from "../config/index.ts";
import type { Config } from "../contracts/index.ts";
import { parseCliArguments, type SessionCommand, usageText } from "./arguments.ts";
import type { CliEnvironment } from "./cli-environment.ts";
import { type ExitCode, exitCodes } from "./exit-codes.ts";
import { runOneShot } from "./one-shot.ts";
import { OneShotApprovalPrompter } from "./one-shot-prompter.ts";
import { combinePromptWithPipedInput, readStream } from "./piped-input.ts";
import { errorMessage, redactSecrets } from "./secrets.ts";
import { runWipe } from "./wipe-command.ts";

export async function runCli(environment: CliEnvironment): Promise<ExitCode> {
  const parsed = parseCliArguments(environment.argv);
  if (!parsed.ok) return usageError(environment, parsed.error);
  const command = parsed.command;
  switch (command.kind) {
    case "help":
      environment.stdout.write(`${usageText}\n`);
      return exitCodes.done;
    case "version":
      environment.stdout.write(`vix ${environment.version}\n`);
      return exitCodes.done;
    case "wipe":
      return runWipe({
        assumeYes: command.assumeYes,
        canAsk: environment.stdinMode === "terminal",
        ask: (question) => askLine(environment, question),
        wipe: () => environment.composition.wipe(),
        stdout: environment.stdout,
        stderr: environment.stderr,
      });
    case "session":
      return runSession(command, environment);
  }
}

async function runSession(command: SessionCommand, environment: CliEnvironment): Promise<ExitCode> {
  const oneShot = command.prompt !== undefined || environment.stdinMode !== "terminal";
  if (command.json && !oneShot) {
    return usageError(environment, "--json applies to one-shot mode (-p or piped stdin).");
  }
  const config = await loadConfigOrReport(command, environment);
  if (!config) return exitCodes.usage;
  if (oneShot) return runOneShotSession(command, config, environment);
  const { startRepl } = await import("./repl/start-repl.ts");
  return startRepl({ command, config, environment });
}

async function runOneShotSession(
  command: SessionCommand,
  config: Config,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const prompter = new OneShotApprovalPrompter();
  const harness = await environment.composition
    .openHarness({
      config,
      approvalPrompter: prompter,
      ephemeral: command.ephemeral,
      resume: command.resume,
      workingDirectory: environment.workingDirectory,
      notify: (text) => environment.stderr.write(`vix: ${redactSecrets(text, config)}\n`),
    })
    .catch((error: unknown) => reportFailure(environment, config, error));
  if (!harness) return exitCodes.failed;

  const controller = new AbortController();
  let interruptCount = 0;
  const removeInterruptHandler = environment.onInterrupt(() => {
    interruptCount += 1;
    controller.abort();
    if (interruptCount > 1) environment.forceExit(exitCodes.cancelled);
  });
  try {
    const piped = shouldReadStdin(command, environment) ? await readStream(environment.stdin) : "";
    const prompt = await combinePromptWithPipedInput(command.prompt, piped, harness);
    if (prompt.trim() === "")
      return usageError(environment, "Nothing to do: pass -p or pipe a prompt.");
    return await runOneShot({
      prompt,
      json: command.json,
      harness,
      prompter,
      signal: controller.signal,
      stdout: environment.stdout,
      stderr: environment.stderr,
      workingDirectory: environment.workingDirectory,
    });
  } catch (error) {
    reportFailure(environment, config, error);
    return exitCodes.failed;
  } finally {
    removeInterruptHandler();
    await harness.close();
  }
}

// With -p, stdin is read only when something was piped or redirected into it. A stdin left
// open by a parent process (an editor, a CI runner) would otherwise block the run forever.
function shouldReadStdin(command: SessionCommand, environment: CliEnvironment): boolean {
  if (environment.stdinMode === "terminal") return false;
  return command.prompt === undefined || environment.stdinMode === "piped";
}

async function loadConfigOrReport(
  command: SessionCommand,
  environment: CliEnvironment,
): Promise<Config | undefined> {
  try {
    return await environment.composition.loadConfig({
      flags: command.configFlags,
      workingDirectory: environment.workingDirectory,
      environment: environment.environment,
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    environment.stderr.write(`vix: ${error.message}\n`);
    return undefined;
  }
}

function reportFailure(environment: CliEnvironment, config: Config, error: unknown): undefined {
  environment.stderr.write(`vix: ${redactSecrets(errorMessage(error), config)}\n`);
  return undefined;
}

function usageError(environment: CliEnvironment, message: string): ExitCode {
  environment.stderr.write(`vix: ${message}\n\n${usageText}\n`);
  return exitCodes.usage;
}

async function askLine(environment: CliEnvironment, question: string): Promise<string> {
  const readline = createInterface({ input: environment.stdin, output: environment.stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}
