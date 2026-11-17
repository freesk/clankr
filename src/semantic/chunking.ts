// Cuts extracted text into passages for embedding (SRCH-9): about `chunkCharacters` long,
// each starting with about `overlapCharacters` of the passage before it, so a sentence that
// straddles a cut is whole in one of the two. Cuts fall on paragraph breaks where one is
// near, otherwise on line breaks. Each passage records its line range, and its page for PDFs.

import type { TextSegment } from "./extract/index.ts";

export interface Chunk {
  text: string;
  /** 1-based lines of the extracted text (of the page, for a PDF). */
  startLine: number;
  endLine: number;
  page?: number;
}

export interface ChunkingOptions {
  chunkCharacters: number;
  overlapCharacters: number;
}

/** A line, or one piece of a line too long to be a passage by itself. */
interface Unit {
  line: number;
  text: string;
}

/** A passage may end early at a paragraph break once it is at least this full. */
const paragraphCutShare = 0.5;

export function chunkSegments(segments: readonly TextSegment[], options: ChunkingOptions): Chunk[] {
  return segments.flatMap((segment) => chunkSegment(segment, options));
}

function chunkSegment(segment: TextSegment, options: ChunkingOptions): Chunk[] {
  const units = toUnits(segment.text, options.chunkCharacters);
  // An overlap of half a passage or more would make each passage mostly a repeat.
  const overlap = Math.min(options.overlapCharacters, Math.floor(options.chunkCharacters / 2));
  const chunks: Chunk[] = [];
  let start = 0;
  let previousEnd = 0;
  while (start < units.length) {
    const end = passageEnd(units, start, previousEnd, options.chunkCharacters);
    const chunk = toChunk(units.slice(start, end), segment.page);
    if (chunk) chunks.push(chunk);
    if (end >= units.length) break;
    previousEnd = end;
    start = Math.max(start + 1, overlapStart(units, end, overlap));
  }
  return chunks;
}

function toUnits(text: string, maxCharacters: number): Unit[] {
  return text.split(/\r?\n/).flatMap((lineText, index) => {
    const pieces =
      lineText.length > maxCharacters ? splitLongLine(lineText, maxCharacters) : [lineText];
    return pieces.map((piece) => ({ line: index + 1, text: piece }));
  });
}

/**
 * The index after the passage's last unit. A passage takes units while they fit, always
 * reaches past `mustPass` (so a passage that starts in the overlap adds something new), and
 * stops at a paragraph break when one comes up in its second half.
 */
function passageEnd(units: Unit[], start: number, mustPass: number, maxCharacters: number): number {
  let length = 0;
  let paragraphEnd: number | undefined;
  for (let index = start; index < units.length; index++) {
    const unitLength = (units[index] as Unit).text.length + 1;
    const mustTake = index === start || index <= mustPass;
    if (!mustTake && length + unitLength > maxCharacters) return paragraphEnd ?? index;
    length += unitLength;
    const isBlank = (units[index] as Unit).text.trim() === "";
    if (isBlank && index > mustPass && length >= maxCharacters * paragraphCutShare) {
      paragraphEnd = index + 1;
    }
  }
  return units.length;
}

/** Where the next passage starts: as many whole units before `end` as fit in the overlap. */
function overlapStart(units: Unit[], end: number, overlapCharacters: number): number {
  let start = end;
  let length = 0;
  while (start > 0) {
    length += (units[start - 1] as Unit).text.length + 1;
    if (length > overlapCharacters) break;
    start--;
  }
  return start;
}

/** Undefined for a stretch of blank lines, which is not worth a vector. */
function toChunk(units: Unit[], page: number | undefined): Chunk | undefined {
  const first = units.findIndex((unit) => unit.text.trim() !== "");
  if (first === -1) return undefined;
  const last = units.findLastIndex((unit) => unit.text.trim() !== "");
  const kept = units.slice(first, last + 1);
  const chunk: Chunk = {
    text: kept.map((unit) => unit.text).join("\n"),
    startLine: (kept[0] as Unit).line,
    endLine: (kept[kept.length - 1] as Unit).line,
  };
  if (page !== undefined) chunk.page = page;
  return chunk;
}

/**
 * Pieces of at most `maxCharacters`, cut after a sentence where one ends in the second half
 * of the piece, otherwise at a space, otherwise mid-word (a minified file has neither).
 * Word documents become one line per paragraph, so this is the common path for them.
 */
function splitLongLine(line: string, maxCharacters: number): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > maxCharacters) {
    const cut = cutPosition(rest, maxCharacters);
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}

function cutPosition(text: string, maxCharacters: number): number {
  const window = text.slice(0, maxCharacters);
  const earliest = Math.floor(maxCharacters / 2);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentenceEnd >= earliest) return sentenceEnd + 1;
  const space = window.lastIndexOf(" ");
  return space >= earliest ? space : maxCharacters;
}
