// Setup steps 1 to 3: where LM Studio runs, the API token (tested at once), and the
// default model, picked from LM Studio's list when it answers.

import type { ModelInfo } from "../../contracts/index.ts";
import { formatModelList, LmStudioError, scrubSecret } from "../../lmstudio/index.ts";
import { errorMessage } from "../secrets.ts";
import { askOrCancel, askYesNo, withDefault } from "./prompter.ts";
import type { SetupContext } from "./setup-context.ts";

export async function askBaseUrl(context: SetupContext, current: string): Promise<string> {
  const { prompter } = context;
  while (true) {
    const answer = await askOrCancel(prompter, withDefault("LM Studio base URL", current));
    const baseUrl = answer || current;
    if (!isHttpUrl(baseUrl)) {
      prompter.print("That is not an http(s) address. Example: http://localhost:1234");
      continue;
    }
    if (!(await context.isLoopback(baseUrl))) prompter.print(nonLoopbackNote(context));
    return baseUrl;
  }
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// SEC-1: the flow does not offer the override; it only says where it lives.
function nonLoopbackNote(context: SetupContext): string {
  if (context.allowNonLoopbackHost) {
    return "This host is not on this machine. lmStudio.allowNonLoopbackHost is true, so clankr will connect to it.";
  }
  return (
    "Warning: this host is not a loopback address, so clankr will refuse to connect to it. " +
    'clankr talks only to an LM Studio on this machine unless you add "allowNonLoopbackHost": true ' +
    `under "lmStudio" in ${context.configFilePath}.`
  );
}

export interface TokenStepResult {
  token: string | undefined;
  /** For the summary, for example "accepted". */
  status: string;
  /** LM Studio's models when it answered, for the model step. */
  models: ModelInfo[] | undefined;
}

type ConnectionCheck =
  | { kind: "ok"; models: ModelInfo[] }
  | { kind: "rejected" | "unreachable" | "failed"; message: string };

export async function askToken(
  context: SetupContext,
  baseUrl: string,
  savedToken: string | undefined,
): Promise<TokenStepResult> {
  const { prompter } = context;
  if (context.environmentToken) {
    prompter.print("LM_API_TOKEN is set in your environment. It overrides the token saved here.");
  }
  while (true) {
    const typed = await askOrCancel(prompter, tokenQuestion(savedToken), { secret: true });
    const token = typed || savedToken;
    const check = await checkConnection(context, baseUrl, token ?? context.environmentToken);
    if (check.kind === "ok") {
      prompter.print(token ? "LM Studio accepted the token." : "LM Studio answered.");
      return { token, status: token ? "accepted" : "not set", models: check.models };
    }
    prompter.print(check.message);
    if (check.kind === "unreachable") {
      return { token, status: "not tested (LM Studio unreachable)", models: undefined };
    }
    if (check.kind === "failed") return { token, status: "not tested", models: undefined };
    if (!(await askYesNo(prompter, "Enter another token?", true))) {
      const status = savedToken ? "unchanged (not verified)" : "not set";
      prompter.print("Skipped: the saved token is left as it was.");
      return { token: savedToken, status, models: undefined };
    }
  }
}

function tokenQuestion(savedToken: string | undefined): string {
  const keep = savedToken ? "Enter keeps the saved one" : "Enter for none";
  return `API token from LM Studio's Developer > Server Settings (hidden; ${keep}): `;
}

async function checkConnection(
  context: SetupContext,
  baseUrl: string,
  token: string | undefined,
): Promise<ConnectionCheck> {
  try {
    const models = await context.probe({
      baseUrl,
      apiToken: token,
      allowNonLoopbackHost: context.allowNonLoopbackHost,
    });
    return { kind: "ok", models };
  } catch (error) {
    // Typed errors never hold the token; anything else is scrubbed to be sure (MOD-2).
    const message = scrubSecret(errorMessage(error), token);
    if (!(error instanceof LmStudioError)) return { kind: "failed", message };
    if (error.kind === "token-rejected") return { kind: "rejected", message };
    if (error.kind === "token-missing") return { kind: "rejected", message };
    if (error.kind === "server-unreachable") {
      return { kind: "unreachable", message: `${message} The token was not tested.` };
    }
    return { kind: "failed", message };
  }
}

export interface ModelStepResult {
  key: string;
  /** Known when LM Studio listed it; gives the context length cap (D47). */
  model: ModelInfo | undefined;
}

export async function askModel(
  context: SetupContext,
  current: string,
  models: ModelInfo[] | undefined,
): Promise<ModelStepResult> {
  const { prompter } = context;
  const languageModels = (models ?? []).filter((model) => model.type === "llm");
  if (languageModels.length > 0) prompter.print(numberedModelList(languageModels, current));
  else if (models) prompter.print("LM Studio lists no downloaded language models.");
  const label = languageModels.length > 0 ? "Default model (number or key)" : "Default model key";
  while (true) {
    const answer = await askOrCancel(prompter, withDefault(label, current));
    const key = modelKeyFor(answer, current, languageModels);
    if (key === undefined) {
      prompter.print(`Pick a number from 1 to ${languageModels.length}, or type a model key.`);
      continue;
    }
    const model = languageModels.find((candidate) => candidate.key === key);
    if (models && !model) {
      prompter.print(`"${key}" is not downloaded in LM Studio. Saved anyway; download it first.`);
    }
    return { key, model };
  }
}

function modelKeyFor(answer: string, current: string, models: ModelInfo[]): string | undefined {
  if (answer === "") return current;
  if (!/^\d+$/.test(answer) || models.length === 0) return answer;
  return models[Number(answer) - 1]?.key;
}

/** The MOD-3 list, numbered for picking. formatModelList keeps the models' order. */
function numberedModelList(models: ModelInfo[], current: string): string {
  const lines = formatModelList(models, current).split("\n");
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width)}. ${line}`).join("\n");
}
