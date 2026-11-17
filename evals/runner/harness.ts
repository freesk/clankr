// What the runner needs from the product. The runner never builds a session
// itself: a HarnessFactory does, once per run, in a clean working directory.
// Wave 2 supplies a factory built on the real agent loop (see real-harness.ts);
// the runner's own tests supply one built on ScriptedLmClient.

import type {
  AgentEvent,
  RunTurn,
  SessionState,
  TurnInput,
  VixPaths,
} from "../../src/contracts/index.ts";

export interface HarnessSetup {
  /** A fresh temporary folder holding the task's fixtures: where `vix` "was started". */
  workingDirectory: string;
  /** A fresh temporary `~/.vix/`, so runs cannot touch each other or the user's data. */
  vixPaths: VixPaths;
}

/** Counted by UsageRecordingLmClient, so no product code needs an evals hook. */
export interface TokenTally {
  /** Prompt tokens over every model request in the run. */
  tokensSent: number;
  /** Model requests that failed because the prompt did not fit. */
  contextOverflows: number;
}

export interface EvalHarness {
  /** Every tool in the registry, whether or not its group is active yet. */
  toolNames(): string[];
  /** Slash commands, without the slash. */
  commandNames(): string[];
  runTurn(input: TurnInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
  /** Runs a slash command line such as "/model some/key". */
  runCommand(commandLine: string, signal: AbortSignal): Promise<void>;
  activeModelKey(): string | undefined;
  tokenTally(): TokenTally;
  close(): Promise<void>;
}

export type HarnessFactory = (setup: HarnessSetup) => Promise<EvalHarness>;

/** The names a task's `requires` list is checked against. */
export function harnessCapabilities(harness: EvalHarness): Set<string> {
  return new Set([
    ...harness.toolNames(),
    ...harness.commandNames().map((name) => `command:${name}`),
  ]);
}

/** Adapts agent-loop's `runTurn(session, input, signal)` to the harness shape. */
export function bindRunTurn(runTurn: RunTurn, session: SessionState): EvalHarness["runTurn"] {
  return (input, signal) => runTurn(session, input, signal);
}
