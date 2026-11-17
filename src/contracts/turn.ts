// Running one turn (seam: agent-loop → cli, evals, subagents).

import type { AgentEvent } from "./events.ts";
import type { UserContentPart } from "./model.ts";
import type { SessionState } from "./session.ts";

/** What the user sent: plain text, or text with attached images. */
export type TurnInput = string | UserContentPart[];

/**
 * The shape of agent-loop's `runTurn(session, input, signal)`. The stream ends
 * with exactly one `turn-end` event.
 */
export type RunTurn = (
  session: SessionState,
  input: TurnInput,
  signal: AbortSignal,
) => AsyncIterable<AgentEvent>;
