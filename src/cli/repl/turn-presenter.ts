// Folds a turn's AgentEvents into REPL state: streamed text and reasoning stay live until a
// tool call or the end of the turn commits them; each finished tool call becomes one line.

import type { AgentEvent, Config, TurnEndReason } from "../../contracts/index.ts";
import { redactSecrets } from "../secrets.ts";
import { ToolLineTracker } from "../tool-lines.ts";
import { appendEntries, type LiveTurn, type ReplState } from "./repl-state.ts";

export const emptyLiveTurn: LiveTurn = { text: "", reasoning: "", runningTool: undefined };

export class TurnPresenter {
  private readonly tracker = new ToolLineTracker();
  private readonly config: Config;
  private readonly showReasoning: boolean;
  private sawTurnEnd = false;

  constructor(config: Config, showReasoning: boolean) {
    this.config = config;
    this.showReasoning = showReasoning;
  }

  get finished(): boolean {
    return this.sawTurnEnd;
  }

  apply(state: ReplState, event: AgentEvent): ReplState {
    const live = state.live ?? emptyLiveTurn;
    switch (event.type) {
      case "model-call-start":
        return state;
      case "text":
        return { ...state, live: { ...live, text: live.text + event.delta } };
      case "reasoning":
        if (!this.showReasoning) return state;
        return { ...state, live: { ...live, reasoning: live.reasoning + event.delta } };
      case "tool-start": {
        this.tracker.start(event);
        const committed = commitLive(state, this.config);
        return {
          ...committed,
          live: { ...emptyLiveTurn, runningTool: this.tracker.runningTool() },
        };
      }
      case "tool-end": {
        const line = this.tracker.end(event);
        const kind = line.failed ? "tool-failed" : "tool";
        const text = redactSecrets(line.text, this.config);
        return {
          ...state,
          entries: appendEntries(state.entries, { kind, text }),
          live: { ...live, runningTool: this.tracker.runningTool() },
        };
      }
      case "turn-end":
        this.sawTurnEnd = true;
        return this.endTurn(state, event.reason, event.message);
    }
  }

  /** For a stream that stopped without a turn-end: cancelled, or thrown. */
  endTurn(state: ReplState, reason: TurnEndReason, message?: string): ReplState {
    const committed = commitLive(state, this.config);
    const closing = closingEntry(reason, message);
    const text = redactSecrets(closing?.text ?? "", this.config);
    const entries = closing
      ? appendEntries(committed.entries, { kind: closing.kind, text })
      : committed.entries;
    return { ...committed, entries, live: undefined };
  }
}

function commitLive(state: ReplState, config: Config): ReplState {
  const live = state.live;
  if (!live) return state;
  const entries = appendEntries(
    state.entries,
    { kind: "reasoning", text: reasoningSummary(live.reasoning, "done") },
    { kind: "assistant", text: redactSecrets(live.text.trim(), config) },
  );
  return { ...state, entries, live: { ...emptyLiveTurn, runningTool: live.runningTool } };
}

function closingEntry(
  reason: TurnEndReason,
  message: string | undefined,
): { kind: "info" | "error"; text: string } | undefined {
  switch (reason) {
    case "done":
      return message ? { kind: "info", text: message } : undefined;
    case "cancelled":
      return { kind: "info", text: message ?? "Cancelled." };
    case "limit":
      return { kind: "info", text: message ?? "Stopped: the turn hit its limit." };
    case "error":
      return { kind: "error", text: message ?? "The turn failed." };
  }
}

/**
 * The model's reasoning is shown as one dim line, not in full: printed out it reads like
 * the answer and buries it. `/think off` turns reasoning off entirely.
 */
export function reasoningSummary(reasoning: string, stage: "live" | "done"): string {
  const words = reasoning.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return "";
  const count = `${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}`;
  return stage === "live" ? `thinking… ${count}` : `thought · ${count}`;
}
