// What the cli needs from the rest of clankr, as one dependency object. The cli never
// imports another part's implementation; composition.ts builds a Harness from them.

import type { ConfigFlags } from "../config/index.ts";
import type {
  AgentEvent,
  ApprovalPrompter,
  Config,
  IndexOutcome,
  IndexRequest,
  IndexRunOptions,
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
  /** D74: one-shot `--allow-data`. Absent means false. */
  allowData?: boolean;
  ephemeral: boolean;
  resume: boolean;
  workingDirectory: string;
  /**
   * Things the user should know that are not part of a turn: LM Studio warnings, a model
   * reload, a resumed session's missing model, a model without native tool calling (MOD-6).
   */
  notify?(text: string): void;
}

export interface IndexCommandOptions extends IndexRunOptions {
  config: Config;
  /** Relative folders resolve against it. */
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
  /**
   * `clankr index` and `/index` (SRCH-9): lists, builds, or removes a semantic search index.
   * Problems the user can fix are printed and reported as "failed", not thrown.
   */
  runIndexRequest(request: IndexRequest, options: IndexCommandOptions): Promise<IndexOutcome>;
  /** Where `clankr config` and `/config` save the settings: `config.json` under `CLANKR_HOME`. */
  configFilePath(): string;
}
