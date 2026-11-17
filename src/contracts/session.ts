// Session-wide state and locations (seams: storage → context, permissions, files, sql;
// search → files for the read tracker; every feature part → cli for slash commands).

import type { Config } from "../config/schema.ts";
import type { ChatMessage, LmClient, LoadedModel, ReasoningSetting } from "./model.ts";
import type { PermissionMode } from "./permissions.ts";
import type { ToolGroup } from "./tools.ts";

/** Every location under `~/.vix/`. Nobody else builds a path there. */
export interface VixPaths {
  root: string;
  configFile: string;
  themeFile: string;
  logsDirectory: string;
  auditLog: string;
  sessionsDirectory: string;
  session: SessionPaths;
}

export interface SessionPaths {
  id: string;
  directory: string;
  transcript: string;
  /** The result store. */
  results: string;
  /** File snapshots for `/undo`. */
  snapshots: string;
  /** Engine scratch space, such as DuckDB spill files. */
  scratch: string;
}

/** A file's state when it was read, so a later overwrite can tell whether it changed (FS-1). */
export interface FileReadState {
  modifiedTimeMs: number;
  sizeBytes: number;
}

export interface ReadTracker {
  markRead(realPath: string, state: FileReadState): void;
  readState(realPath: string): FileReadState | undefined;
}

export interface SessionGrants {
  /** Write tools and `delete`, granted for the session by tool name. */
  tools: Set<string>;
  /** Execute-class grants, keyed by the real path of the data file (D19). */
  dataFiles: Set<string>;
}

export interface SessionState {
  id: string;
  /** Conversation history, without the system prompt and tool definitions. */
  messages: ChatMessage[];
  model: LoadedModel | undefined;
  permissionMode: PermissionMode;
  grants: SessionGrants;
  reasoning: ReasoningSetting;
  ephemeral: boolean;
  /**
   * Tool groups the agent loop switched on during the session, such as "data" once a data
   * file path appears (D15). Kept here so the switch survives eviction, compaction, and resume.
   */
  activatedToolGroups?: ToolGroup[];
}

export interface SlashCommandContext {
  session: SessionState;
  config: Config;
  lm: LmClient;
  print(text: string): void;
  /** Interactive pick from a list. Absent outside the REPL. */
  choose?(prompt: string, options: { label: string; value: string }[]): Promise<string | undefined>;
  /**
   * A typed answer on the input line; undefined when cancelled. A secret answer is masked
   * while it is typed. Absent outside the REPL.
   */
  ask?(prompt: string, options?: { secret?: boolean }): Promise<string | undefined>;
}

export interface SlashCommand {
  /** Without the slash, for example "model". */
  name: string;
  /** One line for `/help`. */
  summary: string;
  /** For example "/model [key]". */
  usage?: string;
  run(argumentText: string, context: SlashCommandContext): Promise<void>;
}

/**
 * Writes the current session's transcript (CLI-9). The cli appends each message as it
 * happens. In an ephemeral session every call is accepted and nothing is written (CLI-7).
 */
export interface SessionTranscript {
  appendMessage(message: ChatMessage): Promise<void>;
  /** The model the session switched to, so a resume can reload it. */
  recordModel(modelKey: string): Promise<void>;
  /**
   * The history was replaced rather than extended (compaction, `/compact`). A resume reads
   * this list in place of every message recorded before it; the older lines stay on disk.
   */
  replaceHistory(messages: ChatMessage[]): Promise<void>;
  /** The tool groups switched on so far (D15), so a resume keeps them. */
  recordToolGroups(groups: ToolGroup[]): Promise<void>;
}

export interface SessionSummary {
  id: string;
  /** ISO time of the first record, when the transcript has one. */
  createdAt: string | undefined;
  /** ISO time the transcript was last written. "Most recent" means this. */
  lastActivityAt: string;
  messageCount: number;
}

/** A saved session read back for `--resume`. */
export interface SavedSession {
  id: string;
  createdAt: string | undefined;
  messages: ChatMessage[];
  /** The last model the session used. The cli falls back to the default if it is gone. */
  modelKey: string | undefined;
  /** Tool groups switched on during the session, from the last record that named them. */
  activatedToolGroups?: ToolGroup[];
}

/** Saved sessions on disk. Sessions with no messages are not listed. */
export interface SessionStore {
  /** Newest first. */
  list(): Promise<SessionSummary[]>;
  load(sessionId: string): Promise<SavedSession>;
  /** The session `vix --resume` opens (D32), or undefined when none is saved. */
  newest(): Promise<SavedSession | undefined>;
}
