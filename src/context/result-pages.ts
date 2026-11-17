// Reading a stored result a page at a time, through the ResultStore contract only, so
// read_result works with any store. A row set reads as one JSON row per line.

import type { ResultMeta, ResultStore } from "../contracts/index.ts";

/** Lines fetched from the store per read while filling a page. */
const chunkLines = 200;

export interface NumberedLine {
  lineNumber: number;
  text: string;
}

/** Yields lines from `startLine` on, in chunks, until the caller stops or the result ends. */
export async function* linesFrom(
  results: ResultStore,
  meta: ResultMeta,
  startLine: number,
): AsyncGenerator<NumberedLine> {
  let next = Math.max(startLine, 1);
  while (next <= meta.itemCount) {
    const chunk = await readChunk(results, meta, next, chunkLines);
    if (chunk.length === 0) return;
    for (const [offset, text] of chunk.entries()) yield { lineNumber: next + offset, text };
    next += chunk.length;
  }
}

async function readChunk(
  results: ResultStore,
  meta: ResultMeta,
  startLine: number,
  lineCount: number,
): Promise<string[]> {
  if (meta.kind === "text") {
    const text = await results.readText(meta.handle, { startLine, lineCount });
    return text.length === 0 && startLine > meta.itemCount ? [] : text.split("\n");
  }
  // The contract reads rows only from the start, so skip to the page wanted.
  const lines: string[] = [];
  let rowNumber = 0;
  for await (const row of results.readRows(meta.handle, startLine + lineCount - 1)) {
    rowNumber += 1;
    if (rowNumber >= startLine) lines.push(JSON.stringify(row));
  }
  return lines;
}
