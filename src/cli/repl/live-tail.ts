// The newest rows of a streaming answer, for when the whole answer no longer fits under the
// prompt. Wrapped with the same function and options Ink uses, so the row count is exact and
// Ink does not wrap the kept rows a second time.

import wrapAnsi from "wrap-ansi";

export interface LiveTail {
  rows: string[];
  /** How many wrapped rows were left out above the kept ones. */
  hiddenRows: number;
}

export function liveTail(text: string, maximumRows: number, columns: number): LiveTail {
  if (maximumRows <= 0) return { rows: [], hiddenRows: 0 };
  const rows = wrapAnsi(text, Math.max(1, columns), { trim: false, hard: true }).split("\n");
  if (rows.length <= maximumRows) return { rows, hiddenRows: 0 };
  return { rows: rows.slice(rows.length - maximumRows), hiddenRows: rows.length - maximumRows };
}
