// The Ink view of the REPL. Loaded only by start-repl.ts, never at startup (CLAUDE.md rule 7).
// Finished output goes to <Static> so long sessions do not re-render old lines.

import { Box, render, Static, Text, useInput } from "ink";
import { createElement as h, type ReactElement, useSyncExternalStore } from "react";
import type { ReplController } from "./controller.ts";
import { ApprovalView, PickerView, QuestionView } from "./dialog-views.ts";
import type { EntryKind, LiveTurn, ReplState, TranscriptEntry } from "./repl-state.ts";

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

function LiveView({ live }: { live: LiveTurn }): ReactElement {
  return h(
    Box,
    { flexDirection: "column" },
    live.reasoning ? h(Text, { dimColor: true, italic: true }, live.reasoning) : null,
    live.text ? h(Text, null, live.text) : null,
    live.runningTool ? h(Text, { dimColor: true }, `  … ${live.runningTool}`) : null,
  );
}

function InputLine({ state }: { state: ReplState }): ReactElement {
  if (state.busy) {
    // A slash command has no activity line of its own.
    const activity = state.activity ?? "Working…";
    return h(Text, { dimColor: true }, `${activity} · Ctrl+C to cancel`);
  }
  return h(
    Text,
    null,
    h(Text, { color: "cyan" }, "› "),
    state.input,
    h(Text, { dimColor: true }, "█"),
  );
}

function Prompt({ state }: { state: ReplState }): ReactElement | null {
  if (state.exited) return null;
  if (state.approval) return h(ApprovalView, { approval: state.approval });
  if (state.choice) return h(PickerView, { choice: state.choice });
  if (state.question) return h(QuestionView, { question: state.question });
  return h(InputLine, { state });
}

export function ReplView({ controller }: { controller: ReplController }): ReactElement {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  useInput((input, key) => controller.handleKey(input, key));
  return h(
    Box,
    { flexDirection: "column" },
    h(Static<TranscriptEntry>, {
      items: state.entries,
      // biome-ignore lint/correctness/noChildrenProp: Static's children is a render function, which createElement's rest arguments cannot type.
      children: (entry: TranscriptEntry) => h(EntryView, { key: entry.id, entry }),
    }),
    state.live ? h(LiveView, { live: state.live }) : null,
    h(Prompt, { state }),
    state.notice ? h(Text, { color: "yellow" }, state.notice) : null,
    state.exited ? null : h(Text, { dimColor: true }, state.statusLine),
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
