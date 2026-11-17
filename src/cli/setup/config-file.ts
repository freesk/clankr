// Reading and writing `~/.vix/config.json` for the setup flow. Only the six settings the
// flow asks about change; every other key in the file is kept as it was.

import { dirname } from "node:path";
import {
  type Config,
  ConfigError,
  type ConfigInput,
  configSchema,
  describeIssues,
  readConfigFile,
} from "../../config/index.ts";
import { ensurePrivateDirectory, writePrivateFile } from "../../storage/index.ts";

/** What the flow asks for. Allowed roots are stored as typed; empty means the start folder. */
export interface SetupAnswers {
  baseUrl: string;
  /** Undefined leaves no token in the file. */
  apiToken: string | undefined;
  model: string;
  contextLength: number;
  permissionMode: Config["permissions"]["mode"];
  allowedRoots: string[];
}

export interface SavedConfig {
  /** The file as written, to merge into. */
  input: ConfigInput;
  /** The file with defaults filled in: the flow's starting values. No environment applied. */
  values: Config;
}

/** Throws ConfigError when the file is not valid JSON or not a valid config. */
export async function readSavedConfig(configFilePath: string): Promise<SavedConfig> {
  const input = await readConfigFile(configFilePath);
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid config in ${configFilePath}: ${describeIssues(parsed.error)}. ` +
        "Fix or delete it, then run setup again.",
    );
  }
  return { input, values: parsed.data };
}

export function currentAnswers(values: Config): SetupAnswers {
  return {
    baseUrl: values.lmStudio.baseUrl,
    apiToken: values.lmStudio.apiToken,
    model: values.model.default,
    contextLength: values.model.contextLength,
    permissionMode: values.permissions.mode,
    allowedRoots: values.permissions.allowedRoots,
  };
}

/** The saved file with the answers applied. Keys the flow does not own pass through. */
export function mergeAnswers(input: ConfigInput, answers: SetupAnswers): ConfigInput {
  const { apiToken: _previousToken, ...lmStudioWithoutToken } = input.lmStudio ?? {};
  return {
    ...input,
    lmStudio: {
      ...lmStudioWithoutToken,
      baseUrl: answers.baseUrl,
      ...(answers.apiToken ? { apiToken: answers.apiToken } : {}),
    },
    model: { ...input.model, default: answers.model, contextLength: answers.contextLength },
    permissions: {
      ...input.permissions,
      mode: answers.permissionMode,
      allowedRoots: answers.allowedRoots,
    },
  };
}

/** Validates the merged file and writes it at 0600, in a 0700 directory (SEC-5). */
export async function saveConfig(configFilePath: string, merged: ConfigInput): Promise<void> {
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(`The new config is not valid: ${describeIssues(parsed.error)}`);
  }
  await ensurePrivateDirectory(dirname(configFilePath));
  await writePrivateFile(configFilePath, `${JSON.stringify(merged, null, 2)}\n`);
}
