// The approval prompt (FS-7, PERM-7) and the picker used by /model. Drawing only: the keys
// are handled in key-handling.ts. Written with createElement so the build needs no JSX step.

import { Box, Text } from "ink";
import { createElement as h, type ReactElement } from "react";
import type { ChangePreview } from "../../contracts/index.ts";
import { filteredOptions } from "./key-handling.ts";
import type { PendingApproval, PendingChoice, PendingQuestion } from "./repl-state.ts";

const maximumPreviewLines = 40;
const visiblePickerRows = 10;

function diffLineColor(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "gray";
  if (line.startsWith("+")) return "green";
  if (line.startsWith("-")) return "red";
  if (line.startsWith("@@")) return "cyan";
  return undefined;
}

function clippedLines(text: string): string[] {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length <= maximumPreviewLines) return lines;
  const hidden = lines.length - maximumPreviewLines;
  return [...lines.slice(0, maximumPreviewLines), `… ${hidden} more lines`];
}

function PreviewBody({ preview }: { preview: ChangePreview }): ReactElement {
  const blocks: ReactElement[] = [];
  if (preview.diff) {
    clippedLines(preview.diff).forEach((line, index) => {
      blocks.push(h(Text, { key: `diff-${index}`, color: diffLineColor(line) }, line));
    });
  }
  if (preview.code) {
    clippedLines(preview.code).forEach((line, index) => {
      blocks.push(h(Text, { key: `code-${index}`, color: "yellow" }, line));
    });
  }
  if (preview.targetPaths.length > 0) {
    blocks.push(
      h(Text, { key: "targets", dimColor: true }, `Writes to: ${preview.targetPaths.join(", ")}`),
    );
  }
  return h(Box, { flexDirection: "column" }, ...blocks);
}

export function ApprovalView({ approval }: { approval: PendingApproval }): ReactElement {
  const { request } = approval;
  const footer =
    approval.stage === "feedback"
      ? h(
          Text,
          null,
          "Tell the model why (Enter to deny, Esc to go back): ",
          h(Text, { color: "cyan" }, `${approval.feedback}█`),
        )
      : h(
          Text,
          null,
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
      { bold: true },
      `Allow ${request.tool.name}? `,
      h(Text, { dimColor: true }, request.reason),
    ),
    h(Text, null, request.preview.summary),
    h(PreviewBody, { preview: request.preview }),
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
      { key: option.value, color: selected ? "cyan" : undefined },
      `${selected ? "❯" : " "} ${option.label}`,
    );
  });
  const empty = options.length === 0 ? h(Text, { dimColor: true }, "  No match.") : null;
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
    h(Text, { bold: true }, choice.prompt),
    h(Text, { dimColor: true }, `Filter: ${choice.filter}█  (↑↓ move, Enter choose, Esc cancel)`),
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
