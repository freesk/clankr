// Pure key handling for the input line, the approval prompt, and the picker.
// Each function says what a key press means; the controller applies it.

import type { ApprovalAnswer } from "../../contracts/index.ts";
import type {
  ChoiceOption,
  KeyPress,
  PendingApproval,
  PendingChoice,
  PendingQuestion,
} from "./repl-state.ts";

export function isCtrlC(input: string, key: KeyPress): boolean {
  return key.ctrl && input === "c";
}

function isNavigationKey(key: KeyPress): boolean {
  return (
    key.return ||
    key.escape ||
    key.tab ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow
  );
}

/** The line after one key press. Pasted newlines become spaces: a prompt is one line. */
export function editLine(line: string, input: string, key: KeyPress): string {
  // Terminals on macOS send DEL for the Backspace key, which Ink reports as `delete`.
  if (key.backspace || key.delete) return line.slice(0, -1);
  if (key.ctrl && input === "u") return "";
  if (key.ctrl && input === "w") return line.replace(/\S*\s*$/, "");
  if (key.ctrl || key.meta || isNavigationKey(key)) return line;
  return line + input.replace(/\r?\n/g, " ");
}

export type ApprovalKeyResult =
  | { kind: "answer"; answer: ApprovalAnswer }
  | { kind: "update"; approval: PendingApproval }
  | { kind: "none" };

/** PERM-7: once, always for this session, or deny with feedback for the model. */
export function approvalKey(
  approval: PendingApproval,
  input: string,
  key: KeyPress,
): ApprovalKeyResult {
  if (approval.stage === "feedback") return feedbackKey(approval, input, key);
  const choice = input.toLowerCase();
  // No default on Enter: a stray key press must not approve a change.
  if (choice === "o" || choice === "1") {
    return { kind: "answer", answer: { kind: "once" } };
  }
  if (choice === "a" || choice === "2") return { kind: "answer", answer: { kind: "session" } };
  if (choice === "d" || choice === "3") {
    return { kind: "update", approval: { ...approval, stage: "feedback" } };
  }
  if (key.escape) return { kind: "answer", answer: { kind: "deny" } };
  return { kind: "none" };
}

function feedbackKey(approval: PendingApproval, input: string, key: KeyPress): ApprovalKeyResult {
  if (key.return) {
    const feedback = approval.feedback.trim();
    return { kind: "answer", answer: feedback ? { kind: "deny", feedback } : { kind: "deny" } };
  }
  if (key.escape) return { kind: "update", approval: { ...approval, stage: "choose" } };
  return {
    kind: "update",
    approval: { ...approval, feedback: editLine(approval.feedback, input, key) },
  };
}

export type ChoiceKeyResult =
  | { kind: "select"; value: string }
  | { kind: "cancel" }
  | { kind: "update"; choice: PendingChoice }
  | { kind: "none" };

export function filteredOptions(choice: PendingChoice): ChoiceOption[] {
  const filter = choice.filter.toLowerCase();
  if (filter === "") return choice.options;
  return choice.options.filter((option) => option.label.toLowerCase().includes(filter));
}

export function choiceKey(choice: PendingChoice, input: string, key: KeyPress): ChoiceKeyResult {
  const visible = filteredOptions(choice);
  if (key.escape) return { kind: "cancel" };
  if (key.return) {
    const selected = visible[choice.highlighted];
    return selected ? { kind: "select", value: selected.value } : { kind: "none" };
  }
  if (key.upArrow || key.downArrow) {
    if (visible.length === 0) return { kind: "none" };
    const step = key.upArrow ? -1 : 1;
    const highlighted = (choice.highlighted + step + visible.length) % visible.length;
    return { kind: "update", choice: { ...choice, highlighted } };
  }
  const filter = editLine(choice.filter, input, key);
  if (filter === choice.filter) return { kind: "none" };
  return { kind: "update", choice: { ...choice, filter, highlighted: 0 } };
}

export type QuestionKeyResult =
  | { kind: "submit"; answer: string }
  | { kind: "cancel" }
  | { kind: "update"; question: PendingQuestion }
  | { kind: "none" };

export function questionKey(
  question: PendingQuestion,
  input: string,
  key: KeyPress,
): QuestionKeyResult {
  if (key.escape) return { kind: "cancel" };
  if (key.return) return { kind: "submit", answer: question.answer };
  const answer = editLine(question.answer, input, key);
  if (answer === question.answer) return { kind: "none" };
  return { kind: "update", question: { ...question, answer } };
}
