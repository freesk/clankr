// Saving, resuming, and wiping sessions (seam: storage → cli). Proposed by the cli part;
// storage implements it.

import type { ChatMessage } from "./model.ts";
import type { VixPaths } from "./session.ts";

export interface OpenSessionOptions {
  /** CLI-7: nothing is left on disk after `close()`. */
  ephemeral: boolean;
  /** CLI-9, D32: open the most recent saved session instead of a new one. */
  resume: boolean;
}

export interface OpenSession {
  paths: VixPaths;
  /** True when an existing session was reopened. */
  resumed: boolean;
  /** History restored from the transcript; empty for a new session. */
  messages: ChatMessage[];
  append(message: ChatMessage): Promise<void>;
  /** Flushes the transcript. An ephemeral session deletes its directory here. */
  close(): Promise<void>;
}

/** What `vix wipe` removed (CLI-6). */
export interface WipeReport {
  sessionsRemoved: number;
  bytesFreed: number;
}

export interface SessionStore {
  open(options: OpenSessionOptions): Promise<OpenSession>;
  /** Deletes every saved session, stored result, and log. */
  wipe(): Promise<WipeReport>;
}
