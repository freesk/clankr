// Loads the config file and layers environment variables and command-line flags on top.
// Precedence, lowest to highest: built-in defaults, config file, environment, flags.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import { type Config, type ConfigInput, configSchema } from "./schema.ts";

/** Flags the cli accepts that override config values. */
export interface ConfigFlags {
  model?: string;
  permissionMode?: Config["permissions"]["mode"];
  baseUrl?: string;
}

export interface LoadConfigOptions {
  /** From `VixPaths.configFile`. A missing file means all defaults. */
  configFilePath: string;
  workingDirectory: string;
  environment?: Record<string, string | undefined>;
  flags?: ConfigFlags;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export async function loadConfig(options: LoadConfigOptions): Promise<Config> {
  const fileInput = await readConfigFile(options.configFilePath);
  const layered = applyOverrides(fileInput, options.environment ?? {}, options.flags ?? {});
  const parsed = configSchema.safeParse(layered);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid config in ${options.configFilePath}: ${describeIssues(parsed.error)}`,
    );
  }
  return withResolvedAllowedRoots(parsed.data, options.workingDirectory);
}

async function readConfigFile(configFilePath: string): Promise<ConfigInput> {
  let text: string;
  try {
    text = await readFile(configFilePath, "utf8");
  } catch (error) {
    if (isFileMissing(error)) return {};
    throw error;
  }
  try {
    return JSON.parse(text) as ConfigInput;
  } catch {
    throw new ConfigError(
      `${configFilePath} is not valid JSON. Fix it or delete it to use defaults.`,
    );
  }
}

function applyOverrides(
  input: ConfigInput,
  environment: Record<string, string | undefined>,
  flags: ConfigFlags,
): ConfigInput {
  const token = environment.LM_API_TOKEN;
  return {
    ...input,
    lmStudio: {
      ...input.lmStudio,
      ...(token ? { apiToken: token } : {}),
      ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
    },
    model: {
      ...input.model,
      ...(flags.model ? { default: flags.model } : {}),
    },
    permissions: {
      ...input.permissions,
      ...(flags.permissionMode ? { mode: flags.permissionMode } : {}),
    },
  };
}

function withResolvedAllowedRoots(config: Config, workingDirectory: string): Config {
  const roots = config.permissions.allowedRoots;
  const allowedRoots =
    roots.length === 0 ? [workingDirectory] : roots.map((root) => resolve(workingDirectory, root));
  return { ...config, permissions: { ...config.permissions, allowedRoots } };
}

// Issue paths and messages only: values are left out because one of them may be the API token.
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
