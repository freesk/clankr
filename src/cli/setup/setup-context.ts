// What every setup step may use, gathered once by the flow.

import type { ModelInfo } from "../../contracts/index.ts";
import type { ProbeSettings } from "../../lmstudio/index.ts";
import type { SetupPrompter } from "./prompter.ts";

export interface SetupContext {
  prompter: SetupPrompter;
  configFilePath: string;
  /** LM_API_TOKEN, which overrides the saved token when set (MOD-2). */
  environmentToken: string | undefined;
  /** From the saved config. The flow shows where to change it but does not ask (SEC-1). */
  allowNonLoopbackHost: boolean;
  /** Relative folders and `~` are resolved against these before saving. */
  workingDirectory: string;
  homeDirectory: string;
  /** Lists LM Studio's models; doubles as the token test. */
  probe(settings: ProbeSettings): Promise<ModelInfo[]>;
  isLoopback(baseUrl: string): Promise<boolean>;
}
