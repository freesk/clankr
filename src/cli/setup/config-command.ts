// The three ways into the setup flow: `clankr config`, `/config` inside the REPL, and the
// offer after a REPL start failed for want of a working token.

import { ConfigError } from "../../config/index.ts";
import type { Config, SlashCommand, SlashCommandContext } from "../../contracts/index.ts";
import { LmStudioError, probeModels } from "../../lmstudio/index.ts";
import type { CliEnvironment } from "../cli-environment.ts";
import { type ExitCode, exitCodes } from "../exit-codes.ts";
import type { SetupAnswers } from "./config-file.ts";
import { askYesNo, type SetupPrompter } from "./prompter.ts";
import { runSetupFlow, type SetupOutcome } from "./setup-flow.ts";
import { TerminalPrompter } from "./terminal-prompter.ts";

/** Real terminals only: a pipe has nobody to answer, and a hidden token needs a terminal. */
export function isInteractiveTerminal(environment: CliEnvironment): boolean {
  return environment.stdinMode === "terminal" && environment.stdout.isTTY === true;
}

function terminalPrompter(environment: CliEnvironment): TerminalPrompter {
  return new TerminalPrompter({
    input: environment.stdin,
    output: environment.stdout,
    terminal: isInteractiveTerminal(environment),
  });
}

function runFlow(environment: CliEnvironment, prompter: SetupPrompter): Promise<SetupOutcome> {
  return runSetupFlow({
    prompter,
    configFilePath: environment.composition.configFilePath(),
    environment: environment.environment,
    workingDirectory: environment.workingDirectory,
  });
}

/** `clankr config`. Exit 2 when the existing config file cannot be read. */
export async function runConfigCommand(environment: CliEnvironment): Promise<ExitCode> {
  const prompter = terminalPrompter(environment);
  try {
    await runFlow(environment, prompter);
    return exitCodes.done;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    environment.stderr.write(`clankr: ${error.message}\n`);
    return exitCodes.usage;
  } finally {
    prompter.close();
  }
}

/** True when LM Studio answers but wants a token, or rejects the configured one. */
async function isTokenProblem(config: Config): Promise<boolean> {
  try {
    await probeModels(config.lmStudio);
    return false;
  } catch (error) {
    return (
      error instanceof LmStudioError &&
      (error.kind === "token-missing" || error.kind === "token-rejected")
    );
  }
}

/**
 * After the REPL failed to start (the error is already printed): on a terminal, when the
 * cause is the token, offer the setup. Asks once more of LM Studio, on failure only.
 */
export async function offerSetupAfterFailedStart(
  environment: CliEnvironment,
  config: Config,
): Promise<void> {
  if (!isInteractiveTerminal(environment)) return;
  if (!(await isTokenProblem(config))) return;
  const prompter = terminalPrompter(environment);
  try {
    if (!(await askYesNo(prompter, "Run the setup (clankr config) now?", false))) return;
    const outcome = await runFlow(environment, prompter);
    if (outcome.kind === "saved") prompter.print("Start clankr again to use the new settings.");
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    environment.stderr.write(`clankr: ${error.message}\n`);
  } finally {
    prompter.close();
  }
}

export interface ConfigCommandOptions {
  configFilePath: string;
  environment: Record<string, string | undefined>;
  workingDirectory: string;
}

/** `/config`: the same flow on the REPL's input line, then applies what it can at once. */
export function createConfigCommand(options: ConfigCommandOptions): SlashCommand {
  return {
    name: "config",
    summary: "Set the LM Studio address, API token, model, and preferences",
    async run(_argumentText, context) {
      const ask = context.ask;
      if (!ask) {
        context.print("Run `clankr config` in a terminal to change the settings.");
        return;
      }
      const outcome = await runSetupFlow({
        prompter: { print: context.print, ask: echoingAsk(ask, context) },
        ...options,
      });
      if (outcome.kind === "saved") applyToSession(outcome.before, outcome.after, context);
    },
  };
}

type Ask = NonNullable<SlashCommandContext["ask"]>;

/** Keeps each answer in the REPL's scrollback; a secret shows only that something was typed. */
function echoingAsk(ask: Ask, context: SlashCommandContext): Ask {
  return async (question, options) => {
    const answer = await ask(question, options);
    if (answer === undefined) return undefined;
    const shown = options?.secret ? (answer.trim() ? "(hidden)" : "") : answer;
    context.print(`${question}${shown}`);
    return answer;
  };
}

/** The permission mode applies now; the rest is read when clankr starts. */
function applyToSession(
  before: SetupAnswers,
  after: SetupAnswers,
  context: SlashCommandContext,
): void {
  if (context.session.permissionMode !== after.permissionMode) {
    context.session.permissionMode = after.permissionMode;
    context.print(`Permission mode is now ${after.permissionMode}.`);
  }
  const needRestart = [
    before.baseUrl !== after.baseUrl && "base URL",
    before.apiToken !== after.apiToken && "API token",
    before.model !== after.model && "default model",
    before.contextLength !== after.contextLength && "context length",
    before.allowedRoots.join("\n") !== after.allowedRoots.join("\n") && "allowed folders",
  ].filter((name): name is string => typeof name === "string");
  if (needRestart.length === 0) return;
  const modelHint = before.model !== after.model ? " Use /model to switch models now." : "";
  context.print(`Restart clankr to use the new ${needRestart.join(", ")}.${modelHint}`);
}
