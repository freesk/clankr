// Reads the argument text a model wrote for a tool call. Small models wrap JSON in code
// fences, leave trailing commas, or encode the object twice; each is fixed here when the
// fix is unambiguous, and reported so the call counts as repaired rather than valid.

import { isPlainObject } from "../shared/index.ts";

export { isPlainObject };

export type LenientParseResult =
  | { ok: true; value: Record<string, unknown>; repaired: boolean }
  | { ok: false };

export function parseArgumentsLeniently(rawText: string): LenientParseResult {
  const trimmed = rawText.trim();
  // An empty argument string is how several models call a tool that takes no parameters.
  if (trimmed === "") return { ok: true, value: {}, repaired: false };

  const direct = tryParse(trimmed);
  if (direct.parsed) return asObject(direct.value, false);

  for (const candidate of repairCandidates(trimmed)) {
    const attempt = tryParse(candidate);
    if (attempt.parsed) return asObject(attempt.value, true);
  }
  return { ok: false };
}

/** Each candidate applies one more fix than the one before. */
function repairCandidates(text: string): string[] {
  const withoutFences = stripCodeFences(text);
  const outerObject = extractOuterObject(withoutFences);
  const withoutTrailingCommas = removeTrailingCommas(outerObject);
  return [withoutFences, outerObject, withoutTrailingCommas];
}

function asObject(value: unknown, repaired: boolean): LenientParseResult {
  if (isPlainObject(value)) return { ok: true, value, repaired };
  // Arguments sent as a JSON string that itself holds the object.
  if (typeof value === "string") {
    const inner = tryParse(value.trim());
    if (inner.parsed && isPlainObject(inner.value)) {
      return { ok: true, value: inner.value, repaired: true };
    }
  }
  return { ok: false };
}

function tryParse(text: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false };
  }
}

function stripCodeFences(text: string): string {
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(text);
  return fenced?.[1] ?? text;
}

/** Drops prose before the first `{` and after the last `}`. */
function extractOuterObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** Removes a comma directly before `}` or `]`. Only outside strings, by walking the text. */
function removeTrailingCommas(text: string): string {
  let result = "";
  let insideString = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (character === '"' && !isEscaped(text, index)) insideString = !insideString;
    if (!insideString && character === "," && closingBrackets.has(nextNonSpace(text, index + 1))) {
      continue;
    }
    result += character;
  }
  return result;
}

const closingBrackets = new Set(["}", "]"]);

function nextNonSpace(text: string, from: number): string {
  for (let index = from; index < text.length; index++) {
    const character = text[index] as string;
    if (!/\s/.test(character)) return character;
  }
  return "";
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let position = index - 1; position >= 0 && text[position] === "\\"; position--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}
