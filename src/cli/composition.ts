// Wires the other parts into the one dependency object the cli uses. This is the only
// file that changes at integration: replace each "not wired" piece with the real part
// (storage's SessionStore and VixPaths, lmstudio's LmClient, context's engine and
// result store, permissions' gate fed by `options.approvalPrompter`, agent-loop's runTurn,
// and every part's SlashCommand registrations).

import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/index.ts";
import type {
  AgentEvent,
  ChatMessage,
  LmClient,
  ResultStore,
  SessionState,
} from "../contracts/index.ts";
import type { CliComposition, Harness, HarnessOptions } from "./harness.ts";

export function createComposition(): CliComposition {
  return {
    loadConfig: ({ flags, workingDirectory, environment }) =>
      loadConfig({
        // Placeholder until storage's VixPaths provides `configFile`.
        configFilePath: join(homedir(), ".vix", "config.json"),
        workingDirectory,
        environment,
        flags,
      }),
    openHarness: async (options) => createUnwiredHarness(options),
    wipe: async () => {
      throw new Error(notWired("vix wipe", "storage"));
    },
  };
}

function notWired(feature: string, part: string): string {
  return `${feature} is not wired yet: the ${part} part is still being built.`;
}

function createSessionState(options: HarnessOptions): SessionState {
  return {
    id: new Date().toISOString(),
    messages: [],
    model: undefined,
    permissionMode: options.config.permissions.mode,
    grants: { tools: new Set(), dataFiles: new Set() },
    reasoning: "off",
    ephemeral: options.ephemeral,
  };
}

function createUnwiredHarness(options: HarnessOptions): Harness {
  if (options.resume) throw new Error(notWired("--resume", "storage"));
  let session = createSessionState(options);
  return {
    config: options.config,
    lm: unwiredLmClient,
    results: unwiredResultStore,
    slashCommands: [],
    resumed: false,
    session: () => session,
    runTurn: (_input, _signal) => unwiredTurn(),
    usage: () => undefined,
    startNewSession: async () => {
      session = createSessionState(options);
    },
    close: async () => {},
  };
}

async function* unwiredTurn(): AsyncIterable<AgentEvent> {
  yield {
    type: "turn-end",
    reason: "error",
    message: notWired("Running a turn", "agent-loop"),
  };
}

const charactersPerToken = 4;

const unwiredLmClient: LmClient = {
  listModels: async () => {
    throw new Error(notWired("Listing models", "lmstudio"));
  },
  loadModel: async () => {
    throw new Error(notWired("Loading a model", "lmstudio"));
  },
  unloadModel: async () => {
    throw new Error(notWired("Unloading a model", "lmstudio"));
  },
  chat: () => {
    throw new Error(notWired("Chat", "lmstudio"));
  },
  // An estimate, so piped stdin can still be measured against the cap.
  countTokens: async (messages: ChatMessage[]) =>
    Math.ceil(JSON.stringify(messages).length / charactersPerToken),
};

function unwiredResults(): never {
  throw new Error(notWired("The result store", "context"));
}

const unwiredResultStore: ResultStore = {
  putText: async () => unwiredResults(),
  putRows: async () => unwiredResults(),
  readText: async () => unwiredResults(),
  readRows: () => unwiredResults(),
  describe: async () => unwiredResults(),
};
