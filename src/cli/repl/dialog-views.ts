// The approval prompt (FS-7, PERM-7) and the picker used by /model. Drawing only: the keys
// are handled in key-handling.ts. Written with createElement so the build needs no JSX step.

import { Box, Text } from "ink";
import { createElement as h, type ReactElement } from "react";
import type { ChangePreview } from "../../contracts/index.ts";
import { filteredOptions } from "./key-handling.ts";
import type { PendingApproval, PendingChoice, PendingQuestion } from "./repl-state.ts";

const maximumPreviewLines = 40;
/** Even on a tiny terminal the user sees a little of what they are approving. */
const minimumPreviewRows = 3;
const visiblePickerRows = 10;
/** Two borders, the prompt, and the filter line around the visible options. */
export const pickerRows = visiblePickerRows + 4;

function diffLineColor(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "gray";
  if (line.startsWith("+")) return "green";
  if (line.startsWith("-")) return "red";
  if (line.startsWith("@@")) return "cyan";
  return undefined;
}

interface PreviewLine {
  text: string;
  color: string | undefined;
}

function splitLines(text: string): string[] {
  return text.replace(/\n$/, "").split("\n");
}

function previewLines(preview: ChangePreview): PreviewLine[] {
  const diff = preview.diff ? splitLines(preview.diff) : [];
  const code = preview.code ? splitLines(preview.code) : [];
  return [
    ...diff.map((text) => ({ text, color: diffLineColor(text) })),
    ...code.map((text) => ({ text, color: "yellow" })),
  ];
}

/** Keeps the first lines that fit, the last row saying how many were left out. */
function clipLines(lines: PreviewLine[], maximumRows: number): PreviewLine[] {
  if (lines.length <= maximumRows) return lines;
  if (maximumRows <= 0) return [];
  const kept = lines.slice(0, maximumRows - 1);
  const hidden = lines.length - kept.length;
  return [...kept, { text: `… ${hidden} more lines`, color: "gray" }];
}

/** Rows the approval box takes besides its preview: two borders, title, summary, footer. */
function approvalChromeRows(approval: PendingApproval): number {
  return 5 + (approval.request.preview.targetPaths.length > 0 ? 1 : 0);
}

/** Every line of the box is one terminal row (long lines are truncated), so this is exact. */
export function approvalRows(approval: PendingApproval, maximumRows: number): number {
  const previewBudget = previewRowBudget(approval, maximumRows);
  const shown = Math.min(previewLines(approval.request.preview).length, previewBudget);
  return approvalChromeRows(approval) + shown;
}

function previewRowBudget(approval: PendingApproval, maximumRows: number): number {
  // The preview is cut before the box can outgrow the screen: a frame taller than the
  // terminal leaves a copy of its top in scrollback on every redraw.
  const fitting = maximumRows - approvalChromeRows(approval);
  return Math.max(minimumPreviewRows, Math.min(maximumPreviewLines, fitting));
}

function PreviewBody({
  preview,
  maximumRows,
}: {
  preview: ChangePreview;
  maximumRows: number;
}): ReactElement {
  const blocks = clipLines(previewLines(preview), maximumRows).map((line, index) =>
    h(Text, { key: `line-${index}`, color: line.color, wrap: "truncate-end" }, line.text || " "),
  );
  if (preview.targetPaths.length > 0) {
    blocks.push(
      h(
        Text,
        { key: "targets", dimColor: true, wrap: "truncate-end" },
        `Writes to: ${preview.targetPaths.join(", ")}`,
      ),
    );
  }
  return h(Box, { flexDirection: "column" }, ...blocks);
}

export function ApprovalView({
  approval,
  maximumRows,
}: {
  approval: PendingApproval;
  maximumRows: number;
}): ReactElement {
  const { request } = approval;
  const footer =
    approval.stage === "feedback"
      ? h(
          Text,
          // Truncated from the start so the end of what is being typed stays in view.
          { wrap: "truncate-start" },
          "Tell the model why (Enter to deny, Esc to go back): ",
          h(Text, { color: "cyan" }, `${approval.feedback}█`),
        )
      : h(
          Text,
          { wrap: "truncate-end" },
          h(Text, { bold: true }, "[o]"),
          " once   ",
          h(Text, { bold: true }, "[a]"),
          " always this session   ",
          h(Text, { bold: true }, "[d]"),
          " deny with feedback   ",
          h(Text, { dimColor: true }, "Esc deny"),
        );
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
    h(
      Text,
      { bold: true, wrap: "truncate-end" },
      `Allow ${request.tool.name}? `,
      h(Text, { dimColor: true }, request.reason),
    ),
    h(Text, { wrap: "truncate-end" }, splitLines(request.preview.summary)[0]),
    h(PreviewBody, {
      preview: request.preview,
      maximumRows: previewRowBudget(approval, maximumRows),
    }),
    footer,
  );
}

export function PickerView({ choice }: { choice: PendingChoice }): ReactElement {
  const options = filteredOptions(choice);
  const firstRow = Math.max(
    0,
    Math.min(
      choice.highlighted - Math.floor(visiblePickerRows / 2),
      options.length - visiblePickerRows,
    ),
  );
  const rows = options.slice(firstRow, firstRow + visiblePickerRows).map((option, offset) => {
    const selected = firstRow + offset === choice.highlighted;
    return h(
      Text,
      { key: option.value, color: selected ? "cyan" : undefined, wrap: "truncate-end" },
      `${selected ? "❯" : " "} ${option.label}`,
    );
  });
  const empty = options.length === 0 ? h(Text, { dimColor: true }, "  No match.") : null;
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
    h(Text, { bold: true, wrap: "truncate-end" }, choice.prompt),
    h(
      Text,
      { dimColor: true, wrap: "truncate-end" },
      `Filter: ${choice.filter}█  (↑↓ move, Enter choose, Esc cancel)`,
    ),
    ...rows,
    empty,
  );
}

/** A setup question on the input line. A secret answer is drawn as asterisks only. */
export function QuestionView({ question }: { question: PendingQuestion }): ReactElement {
  const shown = question.secret ? "*".repeat(question.answer.length) : question.answer;
  return h(
    Text,
    null,
    h(Text, { color: "cyan" }, question.prompt),
    shown,
    h(Text, { dimColor: true }, "█"),
  );
}
