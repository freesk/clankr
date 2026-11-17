// The Ink view of the REPL. Loaded only by start-repl.ts, never at startup (CLAUDE.md rule 7).
// Finished output goes to <Static> so long sessions do not re-render old lines.
//
// Everything below <Static> is redrawn in place and must stay shorter than the terminal.
// Ink can erase only the rows still on screen, so a taller frame leaves a copy of its top in
// scrollback on every redraw, and the activity spinner redraws eight times a second.

import { Box, render, Static, Text, useInput, useWindowSize } from "ink";
import { createElement as h, type ReactElement, useSyncExternalStore } from "react";
import type { ReplController } from "./controller.ts";
import {
  ApprovalView,
  approvalRows,
  PickerView,
  pickerRows,
  QuestionView,
} from "./dialog-views.ts";
import { liveTail } from "./live-tail.ts";
import type { EntryKind, LiveTurn, ReplState, TranscriptEntry } from "./repl-state.ts";

/** The frame stops one row short of the terminal so it never reaches the top. */
const spareRows = 1;
/** Rows the live answer keeps even when a dialog wants the rest of the screen. */
const minimumLiveRows = 2;

const entryStyles: Record<EntryKind, { color?: string; dimColor?: boolean; prefix: string }> = {
  user: { color: "cyan", prefix: "› " },
  assistant: { prefix: "" },
  reasoning: { dimColor: true, prefix: "" },
  tool: { dimColor: true, prefix: "  " },
  "tool-failed": { color: "red", prefix: "  " },
  info: { dimColor: true, prefix: "" },
  error: { color: "red", prefix: "" },
};

function EntryView({ entry }: { entry: TranscriptEntry }): ReactElement {
  const style = entryStyles[entry.kind];
  return h(
    Text,
    { color: style.color, dimColor: style.dimColor, italic: entry.kind === "reasoning" },
    `${style.prefix}${entry.text}`,
  );
}

// Reasoning in progress has no line here: the activity line under the prompt already
// counts its words, and a second count read as the same line printed twice.
//
// A long answer shows only its newest rows while it streams. The full answer goes to the
// transcript when it is committed.
function LiveView({
  live,
  maximumRows,
  columns,
}: {
  live: LiveTurn;
  maximumRows: number;
  columns: number;
}): ReactElement {
  const textRows = maximumRows - (live.runningTool ? 1 : 0);
  const tail = liveTail(live.text, textRows, columns);
  return h(
    Box,
    { flexDirection: "column" },
    live.text && tail.rows.length > 0 ? h(Text, null, tail.rows.join("\n")) : null,
    live.runningTool
      ? h(Text, { dimColor: true, wrap: "truncate-end" }, `  … ${live.runningTool}`)
      : null,
  );
}

function InputLine({ state }: { state: ReplState }): ReactElement {
  if (state.busy) {
    // A slash command has no activity line of its own.
    const activity = state.activity ?? "Working…";
    return h(Text, { dimColor: true, wrap: "truncate-end" }, `${activity} · Ctrl+C to cancel`);
  }
  return h(
    Text,
    // Truncated from the start so the end of a long input, where typing happens, stays in view.
    { wrap: "truncate-start" },
    h(Text, { color: "cyan" }, "› "),
    state.input,
    h(Text, { dimColor: true }, "█"),
  );
}

function Prompt({ state, maximumRows }: { state: ReplState; maximumRows: number }) {
  if (state.exited) return null;
  if (state.approval) return h(ApprovalView, { approval: state.approval, maximumRows });
  if (state.choice) return h(PickerView, { choice: state.choice });
  if (state.question) return h(QuestionView, { question: state.question });
  return h(InputLine, { state });
}

function promptRows(state: ReplState, maximumRows: number): number {
  if (state.exited) return 0;
  if (state.approval) return approvalRows(state.approval, maximumRows);
  if (state.choice) return pickerRows;
  return 1;
}

/** How the rows under <Static> are shared: the prompt first, the live answer gets the rest. */
function frameBudget(state: ReplState, terminalRows: number) {
  const fixedRows = (state.notice ? 1 : 0) + (state.exited ? 0 : 1);
  const available = terminalRows - spareRows - fixedRows;
  const prompt = promptRows(state, available - minimumLiveRows);
  return { promptRows: available - minimumLiveRows, liveRows: Math.max(0, available - prompt) };
}

export function ReplView({ controller }: { controller: ReplController }): ReactElement {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { rows, columns } = useWindowSize();
  useInput((input, key) => controller.handleKey(input, key));
  const budget = frameBudget(state, rows);
  return h(
    Box,
    { flexDirection: "column" },
    h(Static<TranscriptEntry>, {
      items: state.entries,
      // biome-ignore lint/correctness/noChildrenProp: Static's children is a render function, which createElement's rest arguments cannot type.
      children: (entry: TranscriptEntry) => h(EntryView, { key: entry.id, entry }),
    }),
    state.live && budget.liveRows > 0
      ? h(LiveView, { live: state.live, maximumRows: budget.liveRows, columns })
      : null,
    h(Prompt, { state, maximumRows: budget.promptRows }),
    state.notice ? h(Text, { color: "yellow", wrap: "truncate-end" }, state.notice) : null,
    state.exited ? null : h(Text, { dimColor: true, wrap: "truncate-end" }, state.statusLine),
  );
}

export interface ReplStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

export function mountReplView(controller: ReplController, streams: ReplStreams) {
  return render(h(ReplView, { controller }), {
    stdin: streams.stdin,
    stdout: streams.stdout,
    // Ctrl+C is CLI-5's job: cancel first, exit on the second press.
    exitOnCtrlC: false,
    patchConsole: false,
  });
}
