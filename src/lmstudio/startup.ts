// Connecting at startup: probe the server, then load the default model (MOD-5, MOD-8).
// Each failure is an LmStudioError of its own kind, with the fix to show the user.

import type { LoadedModel, SessionState } from "../contracts/index.ts";
import type { LmStudioClient } from "./client.ts";
import type { ModelSwitcher, Notify } from "./model-switcher.ts";
import { checkServer } from "./server-check.ts";

export interface StartupOptions {
  client: LmStudioClient;
  switcher: ModelSwitcher;
  session: SessionState;
  /** The model to start on: `config.model.default`, already overridden by `--model`. */
  modelKey: string;
  notify: Notify;
}

/**
 * Throws LmStudioError with kind "server-unreachable", "token-missing", "token-rejected",
 * "model-not-downloaded", "model-load-failed", or "host-not-allowed".
 */
export async function connectAtStartup(options: StartupOptions): Promise<LoadedModel> {
  const warnings = await checkServer(options.client.transport);
  for (const warning of warnings) options.notify(warning);
  return options.switcher.switchTo(options.modelKey, options.session, options.notify);
}
