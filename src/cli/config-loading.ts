// Loading the config for a command, with an invalid config file reported as a usage problem
// and not a crash. Shared by the session commands and `clankr index`.

import { ConfigError, type ConfigFlags } from "../config/index.ts";
import type { Config } from "../contracts/index.ts";
import type { CliEnvironment } from "./cli-environment.ts";

/** Undefined when the config file is invalid; the reason has been printed. */
export async function loadConfigOrReport(
  flags: ConfigFlags,
  environment: CliEnvironment,
): Promise<Config | undefined> {
  try {
    return await environment.composition.loadConfig({
      flags,
      workingDirectory: environment.workingDirectory,
      environment: environment.environment,
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    environment.stderr.write(`clankr: ${error.message}\n`);
    return undefined;
  }
}
