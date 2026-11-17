// What the REPL shows, as plain data. The controller changes it; the Ink view draws it.

import type { ApprovalRequest } from "../../contracts/index.ts";

export type EntryKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool"
  | "tool-failed"
  | "info"
  | "error";

/** A finished block of output. Entries are only appended, so the index is a stable id. */
export interface TranscriptEntry {
  id: number;
  kind: EntryKind;
  text: string;
}

/** Output of the turn in progress, before it is committed to the transcript. */
export interface LiveTurn {
  text: string;
  reasoning: string;
  runningTool: string | undefined;
}

export interface PendingApproval {
  request: ApprovalRequest;
  /** "feedback" while the user types why they deny. */
  stage: "choose" | "feedback";
  feedback: string;
}

export interface ChoiceOption {
  label: string;
  value: string;
}

export interface PendingChoice {
  prompt: string;
  options: ChoiceOption[];
  /** Typed text that narrows the list. */
  filter: string;
  /** Index into the filtered options. */
  highlighted: number;
}

/** A typed answer to a question, as the `/config` setup asks them. */
export interface PendingQuestion {
  prompt: string;
  /** Drawn as asterisks, never as the typed text. */
  secret: boolean;
  answer: string;
}

export interface ReplState {
  entries: TranscriptEntry[];
  live: LiveTurn | undefined;
  /** The dim line that shows a running turn is working, such as `⠙ thinking · 412 words · 18s`. */
  activity: string | undefined;
  input: string;
  statusLine: string;
  /** A one-line hint, such as "Press Ctrl+C again to exit". */
  notice: string | undefined;
  approval: PendingApproval | undefined;
  choice: PendingChoice | undefined;
  question: PendingQuestion | undefined;
  /** A turn or a slash command is running. */
  busy: boolean;
  exited: boolean;
}

/** The subset of Ink's key object the REPL reads, so the logic is testable without Ink. */
export interface KeyPress {
  ctrl: boolean;
  meta: boolean;
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  tab: boolean;
}

export function appendEntries(
  entries: TranscriptEntry[],
  ...additions: { kind: EntryKind; text: string }[]
): TranscriptEntry[] {
  const appended = additions
    .filter((addition) => addition.text !== "")
    .map((addition, index) => ({ id: entries.length + index, ...addition }));
  return appended.length === 0 ? entries : [...entries, ...appended];
}
