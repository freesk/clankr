// The model side of the harness: the LmClient, how the first model is connected at startup,
// and how the connection is released on exit. Tests swap in a scripted client here.

import type { Config, LmClient, LoadedModel, SessionState } from "../contracts/index.ts";
import {
  connectAtStartup,
  LmStudioClient,
  LmStudioError,
  type ModelSwitcher,
  type Notify,
} from "../lmstudio/index.ts";

export interface ConnectOptions {
  switcher: ModelSwitcher;
  session: SessionState;
  modelKey: string;
  notify: Notify;
}

export interface LmConnection {
  lm: LmClient;
  /** Checks the server and loads the first model (MOD-5, MOD-8). Throws a user-facing error. */
  connect(options: ConnectOptions): Promise<LoadedModel>;
  /** Releases the connection so the process can exit (the SDK keeps a WebSocket open). */
  dispose(): Promise<void>;
}

export type CreateLmConnection = (config: Config, notify: Notify) => Promise<LmConnection>;

/** The real LM Studio client. */
export const createLmStudioConnection: CreateLmConnection = async (config, notify) => {
  const client = new LmStudioClient({ config, onWarning: notify });
  return {
    lm: client,
    async connect(options) {
      try {
        return await connectAtStartup({ client, ...options });
      } catch (error) {
        // The typed errors carry the fix for the user (MOD-8); show that, not the bare message.
        if (error instanceof LmStudioError) throw new Error(error.describe());
        throw error;
      }
    },
    dispose: () => client.dispose(),
  };
};

/** Any LmClient, such as the scripted fake: connecting is just switching to the model. */
export function plainLmConnection(lm: LmClient): LmConnection {
  return {
    lm,
    connect: ({ switcher, session, modelKey, notify }) =>
      switcher.switchTo(modelKey, session, notify),
    dispose: async () => {},
  };
}
