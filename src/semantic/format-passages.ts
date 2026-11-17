// How passages and index ages are shown, to the model and in `clankr index --status`.
// Compact for the same reason as the other search results: every token is budgeted.

import { usablePath } from "../tools/search/format.ts";
import { indexableKindOf } from "./extract/index.ts";

/** A passage ready to show: where it is on disk now, and whether its file changed since. */
export interface PassageHit {
  /** Absolute path of the file. */
  path: string;
  startLine: number;
  endLine: number;
  page: number | undefined;
  text: string;
  score: number;
  changedSinceIndexed: boolean;
}

export const changedMarker = "[changed]";

/**
 * notes/plan.md:12-30 (0.71)
 *   The first characters of the passage …
 */
export function formatPassage(
  hit: PassageHit,
  workingDirectory: string,
  snippetCharacters: number,
): string {
  const changed = hit.changedSinceIndexed ? ` ${changedMarker}` : "";
  const heading = `${usablePath(hit.path, workingDirectory)}${location(hit)} (${hit.score.toFixed(2)})${changed}`;
  return `${heading}\n  ${snippet(hit.text, snippetCharacters)}`;
}

/**
 * A page for a PDF, a line range for a text file (it is what `read_file` takes), nothing for
 * a Word-like document, whose lines exist only in the converted text.
 */
function location(hit: PassageHit): string {
  if (hit.page !== undefined) return ` p.${hit.page}`;
  if (indexableKindOf(hit.path) !== "text") return "";
  return hit.startLine === hit.endLine ? `:${hit.startLine}` : `:${hit.startLine}-${hit.endLine}`;
}

/** The passage on one line, cut at a word boundary. */
export function snippet(text: string, maxCharacters: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxCharacters) return oneLine;
  const cut = oneLine.slice(0, maxCharacters);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxCharacters / 2 ? lastSpace : maxCharacters)} …`;
}

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

/** "just now", "12 min ago", "5 h ago", "3 days ago". */
export function formatAge(isoTime: string, now: Date = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - new Date(isoTime).getTime());
  if (elapsed < minuteMs) return "just now";
  if (elapsed < hourMs) return `${Math.floor(elapsed / minuteMs)} min ago`;
  if (elapsed < dayMs) return `${Math.floor(elapsed / hourMs)} h ago`;
  const days = Math.floor(elapsed / dayMs);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
