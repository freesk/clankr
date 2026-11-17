// Running one turn (seam: agent-loop → cli, evals, subagents).

import type { AgentEvent } from "./events.ts";
import type { SessionState } from "./session.ts";

/** Prose plus file paths attached by typing or dragging (CLI-10). Images are read by tools, not inlined. */
export interface TurnInputWithAttachments {
  text: string;
  attachmentPaths?: string[];
}

/** What the user sent. Matches agent-loop's `runTurn`. */
export type TurnInput = string | TurnInputWithAttachments;

/**
 * The shape of agent-loop's `runTurn(session, input, signal)`. The stream ends
 * with exactly one `turn-end` event.
 */
export type RunTurn = (
  session: SessionState,
  input: TurnInput,
  signal: AbortSignal,
) => AsyncIterable<AgentEvent>;
