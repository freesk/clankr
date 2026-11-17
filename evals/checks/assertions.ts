// Evaluates a task's assertions after a run. Assertions check outcomes (files,
// artefacts, facts in the answer), never the model's phrasing.

import type { Assertion } from "../tasks/schema.ts";
import { checkChartSpec, checkPdfCreated } from "./artefact-checks.ts";
import {
  checkDirectoryExists,
  checkFileAbsent,
  checkFileContains,
  checkFileCount,
  checkFileExists,
  checkFileUnchanged,
} from "./file-checks.ts";
import type { AssertionContext, CheckResult } from "./types.ts";

/** The reason for each failed assertion; empty when all passed. */
export async function evaluateAssertions(
  assertions: Assertion[],
  context: AssertionContext,
): Promise<string[]> {
  const failures: string[] = [];
  for (const assertion of assertions) {
    const failure = await evaluateAssertion(assertion, context);
    if (failure) failures.push(`${assertion.kind}: ${failure}`);
  }
  return failures;
}

function evaluateAssertion(assertion: Assertion, context: AssertionContext): CheckResult {
  switch (assertion.kind) {
    case "file-exists":
      return checkFileExists(context, assertion.path);
    case "file-absent":
      return checkFileAbsent(context, assertion.path);
    case "directory-exists":
      return checkDirectoryExists(context, assertion.path);
    case "file-contains":
      return checkFileContains(context, assertion.path, assertion.text, true);
    case "file-not-contains":
      return checkFileContains(context, assertion.path, assertion.text, false);
    case "file-unchanged":
      return checkFileUnchanged(context, assertion.path);
    case "file-count":
      return checkFileCount(context, assertion.directory, assertion.suffix, assertion.count);
    case "answer-contains":
      return checkAnswerContains(context.finalAnswer, assertion.anyOf);
    case "answer-not-contains":
      return checkAnswerOmits(context.finalAnswer, assertion.noneOf);
    case "answer-number":
      return checkAnswerNumber(context.finalAnswer, assertion.value, assertion.tolerance);
    case "tool-called":
      return checkToolCalled(context, assertion.tool, true);
    case "tool-not-called":
      return checkToolCalled(context, assertion.tool, false);
    case "pdf-created":
      return checkPdfCreated(context, assertion.directory);
    case "chart-spec":
      return checkChartSpec(context, assertion.directory, assertion);
    case "active-model":
      return checkActiveModel(context, assertion.key);
  }
}

async function checkAnswerContains(answer: string, anyOf: string[]): CheckResult {
  const lowerAnswer = answer.toLowerCase();
  if (anyOf.some((text) => lowerAnswer.includes(text.toLowerCase()))) return undefined;
  return `the answer mentions none of: ${anyOf.join(", ")}`;
}

async function checkAnswerOmits(answer: string, noneOf: string[]): CheckResult {
  const lowerAnswer = answer.toLowerCase();
  const found = noneOf.filter((text) => lowerAnswer.includes(text.toLowerCase()));
  return found.length === 0 ? undefined : `the answer mentions ${found.join(", ")}`;
}

async function checkAnswerNumber(answer: string, value: number, tolerance: number): CheckResult {
  const numbers = numbersIn(answer);
  if (numbers.some((number) => Math.abs(number - value) <= tolerance)) return undefined;
  return `no number within ${tolerance} of ${value} in the answer (found ${numbers.join(", ") || "none"})`;
}

/** Numbers as people write them: "1,234.5", "$42.50", "-3", "750 000". */
export function numbersIn(text: string): number[] {
  const matches = text.match(/-?\d{1,3}(?:[,   ]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map((match) => Number(match.replace(/[,   ]/g, "")));
}

async function checkToolCalled(
  context: AssertionContext,
  tool: string,
  expected: boolean,
): CheckResult {
  const called = context.toolCalls.some((call) => call.tool === tool);
  if (called === expected) return undefined;
  return expected ? `${tool} was never called` : `${tool} was called`;
}

async function checkActiveModel(context: AssertionContext, key: string): CheckResult {
  return context.activeModelKey === key
    ? undefined
    : `active model is ${context.activeModelKey ?? "none"}, expected ${key}`;
}
