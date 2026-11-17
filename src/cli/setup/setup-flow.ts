// The guided setup behind `vix config` and `/config` (D73): six questions, a summary, a
// confirmation, then `config.json` is written at 0600. Cancelling at any point writes nothing.

import { homedir } from "node:os";
import { formatCount, isLoopbackBaseUrl, probeModels } from "../../lmstudio/index.ts";
import {
  currentAnswers,
  mergeAnswers,
  readSavedConfig,
  type SetupAnswers,
  saveConfig,
} from "./config-file.ts";
import { askBaseUrl, askModel, askToken } from "./connection-steps.ts";
import {
  askAllowedRoots,
  askContextLength,
  askPermissionMode,
  describeAllowedRoots,
} from "./preference-steps.ts";
import { askYesNo, SetupCancelled, type SetupPrompter } from "./prompter.ts";
import type { SetupContext } from "./setup-context.ts";

export interface SetupFlowOptions {
  prompter: SetupPrompter;
  /** From storage's layout, so `VIX_HOME` is respected. */
  configFilePath: string;
  environment: Record<string, string | undefined>;
  workingDirectory: string;
  homeDirectory?: string;
  /** Replace the LM Studio checks in tests; default to the real ones. */
  probe?: SetupContext["probe"];
  isLoopback?: SetupContext["isLoopback"];
}

export type SetupOutcome =
  | { kind: "saved"; before: SetupAnswers; after: SetupAnswers }
  | { kind: "cancelled" };

const introduction =
  "vix setup. Press Enter to keep the value in brackets, Ctrl+C to cancel. Nothing is saved until you confirm.";

/** Throws ConfigError when the existing file cannot be read as a config. */
export async function runSetupFlow(options: SetupFlowOptions): Promise<SetupOutcome> {
  const { prompter, configFilePath } = options;
  const saved = await readSavedConfig(configFilePath);
  const context = buildContext(options, saved.values.lmStudio.allowNonLoopbackHost);
  const before = currentAnswers(saved.values);
  prompter.print(introduction);
  let after: SetupAnswers;
  try {
    after = await askEverything(context, before);
    if (!(await askYesNo(prompter, `Save to ${configFilePath}?`, true))) {
      prompter.print("Nothing saved.");
      return { kind: "cancelled" };
    }
  } catch (error) {
    if (!(error instanceof SetupCancelled)) throw error;
    prompter.print("Setup cancelled. Nothing saved.");
    return { kind: "cancelled" };
  }
  await saveConfig(configFilePath, mergeAnswers(saved.input, after));
  prompter.print(`Saved ${configFilePath}.`);
  if (context.environmentToken) {
    prompter.print("Note: LM_API_TOKEN is set, and it still overrides the saved token.");
  }
  return { kind: "saved", before, after };
}

function buildContext(options: SetupFlowOptions, allowNonLoopbackHost: boolean): SetupContext {
  return {
    prompter: options.prompter,
    configFilePath: options.configFilePath,
    environmentToken: options.environment.LM_API_TOKEN || undefined,
    allowNonLoopbackHost,
    workingDirectory: options.workingDirectory,
    homeDirectory: options.homeDirectory ?? homedir(),
    probe: options.probe ?? probeModels,
    isLoopback: options.isLoopback ?? ((baseUrl) => isLoopbackBaseUrl(baseUrl)),
  };
}

async function askEverything(context: SetupContext, current: SetupAnswers): Promise<SetupAnswers> {
  const baseUrl = await askBaseUrl(context, current.baseUrl);
  const token = await askToken(context, baseUrl, current.apiToken);
  const model = await askModel(context, current.model, token.models);
  const contextLength = await askContextLength(context, current.contextLength, model.model);
  const permissionMode = await askPermissionMode(context, current.permissionMode);
  const allowedRoots = await askAllowedRoots(context, current.allowedRoots);
  const answers: SetupAnswers = {
    baseUrl,
    apiToken: token.token,
    model: model.key,
    contextLength,
    permissionMode,
    allowedRoots,
  };
  context.prompter.print(summary(answers, token.status));
  return answers;
}

function summary(answers: SetupAnswers, tokenStatus: string): string {
  const token = answers.apiToken ? `${maskToken(answers.apiToken)} (${tokenStatus})` : "not set";
  const rows: [string, string][] = [
    ["LM Studio base URL", answers.baseUrl],
    ["API token", token],
    ["Default model", answers.model],
    ["Context length", formatCount(answers.contextLength)],
    ["Permission mode", answers.permissionMode],
    ["Allowed folders", describeAllowedRoots(answers.allowedRoots)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return ["Summary:", ...rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)].join(
    "\n",
  );
}

/** At most the `sk-` prefix and the last four characters (MOD-2); short tokens show nothing. */
export function maskToken(token: string): string {
  if (token.length < 12) return "(hidden)";
  const prefix = token.startsWith("sk-") ? "sk-" : "";
  return `${prefix}…${token.slice(-4)}`;
}
