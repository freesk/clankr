// The result handle scheme: "r" followed by a number, for example "r12".
// Handles are short because the model repeats them and every character costs tokens.

import type { ResultHandle } from "../contracts/index.ts";

const handlePattern = /^r([1-9]\d*)$/;
const handleInTextPattern = /\br[1-9]\d*\b/g;

/** True for a well-formed handle. Also what keeps a model-written handle from naming another path. */
export function isResultHandle(candidate: string): boolean {
  return handlePattern.test(candidate);
}

export function handleNumber(handle: ResultHandle): number | undefined {
  const match = handlePattern.exec(handle);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function handleFromNumber(value: number): ResultHandle {
  return `r${value}`;
}

/** Every handle-shaped word in a text, in order of first appearance, without repeats. */
export function handlesMentionedIn(text: string): ResultHandle[] {
  return [...new Set(text.match(handleInTextPattern) ?? [])];
}
