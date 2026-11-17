// Running one turn (seam: cli → agent-loop). The cli turns what the user typed into a
// TurnInput; the agent loop answers with an AgentEvent stream.

import type { AgentEvent } from "./events.ts";
import type { SessionState } from "./session.ts";

/** A path the user typed or dragged into the prompt that exists on disk (CLI-10). */
export interface Attachment {
  /** Absolute path with `~` expanded, quoting and backslash escapes removed. */
  path: string;
  kind: "image" | "file";
  /** Short name left in the prompt text where the path was, for example "[photo.png]". */
  label: string;
}

export interface TurnInput {
  /** The prompt with attached paths replaced by their labels. */
  text: string;
  attachments: Attachment[];
}

/** Runs one user turn to completion. The stream always ends with a `turn-end` event. */
export type RunTurn = (
  session: SessionState,
  input: TurnInput,
  signal: AbortSignal,
) => AsyncIterable<AgentEvent>;
