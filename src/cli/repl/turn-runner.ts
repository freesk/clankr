// Runs one REPL turn: folds its events into the transcript, keeps the activity line moving
// on a timer, and refreshes the status line's token count after every model call.

import type { AgentEvent, TurnInputWithAttachments } from "../../contracts/index.ts";
import { untilAborted } from "../abortable.ts";
import type { Harness } from "../harness.ts";
import { errorMessage } from "../secrets.ts";
import type { ReplState } from "./repl-state.ts";
import { activityRefreshMilliseconds, TurnActivity } from "./turn-activity.ts";
import { TurnPresenter } from "./turn-presenter.ts";

export interface ReplStateStore {
  get(): ReplState;
  set(next: ReplState): void;
}

export interface ReplTurnOptions {
  harness: Harness;
  showReasoning: boolean;
  store: ReplStateStore;
  /** The status line as it reads now, with the context engine's latest count. */
  statusLine(): string;
}

/** Resolves when the turn has ended, however it ended; never throws. */
export async function runReplTurn(
  options: ReplTurnOptions,
  input: TurnInputWithAttachments,
  signal: AbortSignal,
): Promise<void> {
  const { harness, store } = options;
  const presenter = new TurnPresenter(harness.config, options.showReasoning);
  const activity = new TurnActivity(Date.now());
  const redrawActivity = () =>
    store.set({ ...store.get(), activity: activity.describe(Date.now()) });
  redrawActivity();
  const ticker = setInterval(redrawActivity, activityRefreshMilliseconds);
  try {
    const events = harness.runTurn(input, signal);
    for await (const event of untilAborted(events, signal)) {
      activity.apply(event, Date.now());
      store.set(withEvent(store.get(), event, presenter, options));
      redrawActivity();
    }
    if (!presenter.finished) {
      const reason = signal.aborted ? "cancelled" : "error";
      store.set(presenter.endTurn(store.get(), reason));
    }
  } catch (error) {
    const reason = signal.aborted ? "cancelled" : "error";
    store.set(presenter.endTurn(store.get(), reason, errorMessage(error)));
  } finally {
    clearInterval(ticker);
    store.set({ ...store.get(), activity: undefined, statusLine: options.statusLine() });
  }
}

function withEvent(
  state: ReplState,
  event: AgentEvent,
  presenter: TurnPresenter,
  options: ReplTurnOptions,
): ReplState {
  const next = presenter.apply(state, event);
  // Streamed deltas change nothing the context engine counts; every other event follows a
  // prepared request or a recorded usage, so the count may have moved.
  if (event.type === "text" || event.type === "reasoning") return next;
  return { ...next, statusLine: options.statusLine() };
}
