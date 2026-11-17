// What the cli needs from the rest of vix, as one dependency object. The cli never
// imports another part's implementation; composition.ts builds a Harness from them.

import type { ConfigFlags } from "../config/index.ts";
import type {
  AgentEvent,
  ApprovalPrompter,
  Config,
  LmClient,
  ResultStore,
  SessionState,
  SlashCommand,
  TurnInputWithAttachments,
  UsageSnapshot,
  WipeReport,
} from "../contracts/index.ts";

export interface HarnessOptions {
  config: Config;
  /** The REPL's prompt, or the one-shot prompter that always denies (D14). */
  approvalPrompter: ApprovalPrompter;
  ephemeral: boolean;
  resume: boolean;
  workingDirectory: string;
}

/** One running session and everything the cli calls on it. */
export interface Harness {
  readonly config: Config;
  readonly lm: LmClient;
  /** Where piped stdin goes when it is over the cap. */
  readonly results: ResultStore;
  /** Commands registered by the parts that own them (CLI-3). */
  readonly slashCommands: readonly SlashCommand[];
  /** True when `--resume` reopened a saved session. */
  readonly resumed: boolean;
  session(): SessionState;
  runTurn(input: TurnInputWithAttachments, signal: AbortSignal): AsyncIterable<AgentEvent>;
  /** Undefined until the context engine has measured anything. */
  usage(): UsageSnapshot | undefined;
  /** `/clear` (D32): a new session with empty context; the old one stays on disk. */
  startNewSession(): Promise<void>;
  /** Ends the session. An ephemeral session leaves nothing on disk after this. */
  close(): Promise<void>;
}

/** The single place where the cli meets the other parts. */
export interface CliComposition {
  loadConfig(options: {
    flags: ConfigFlags;
    workingDirectory: string;
    environment: Record<string, string | undefined>;
  }): Promise<Config>;
  openHarness(options: HarnessOptions): Promise<Harness>;
  wipe(): Promise<WipeReport>;
}
