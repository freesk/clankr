// Session-wide state and locations (seams: storage → context, permissions, files, sql;
// search → files for the read tracker; every feature part → cli for slash commands).

import type { Config } from "../config/schema.ts";
import type { ChatMessage, LmClient, LoadedModel, ReasoningSetting } from "./model.ts";
import type { PermissionMode } from "./permissions.ts";

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
}

export interface SlashCommandContext {
  session: SessionState;
  config: Config;
  lm: LmClient;
  print(text: string): void;
  /** Interactive pick from a list. Absent outside the REPL. */
  choose?(prompt: string, options: { label: string; value: string }[]): Promise<string | undefined>;
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
