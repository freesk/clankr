// Finding the header row. Real spreadsheets put titles, notes, and blank rows above
// the header; the header is the first row that is about as wide as the table and
// reads as labels rather than values.

export type CellText = string | null;

/** How many leading rows are examined. */
export const headerSearchRows = 30;

/** Share of the widest row's filled cells a header must have. */
const widthShare = 0.6;

/** Returns the 1-based header row among `rows` (the first rows of the sheet). */
export function detectHeaderRow(rows: CellText[][]): number {
  const widths = rows.map(filledCount);
  const widest = Math.max(0, ...widths);
  if (widest === 0) return 1;
  const minimumWidth = Math.max(1, Math.ceil(widest * widthShare));
  const wideEnough = (index: number) => (widths[index] ?? 0) >= minimumWidth;

  for (let index = 0; index < rows.length; index++) {
    if (wideEnough(index) && looksLikeLabels(rows[index] ?? [])) return index + 1;
  }
  const firstWide = widths.findIndex((_, index) => wideEnough(index));
  return firstWide + 1;
}

function filledCount(row: CellText[]): number {
  return row.filter(isFilled).length;
}

function isFilled(cell: CellText): cell is string {
  return cell !== null && cell.trim() !== "";
}

/** Mostly text, and no label repeated: what a header row looks like. */
function looksLikeLabels(row: CellText[]): boolean {
  const filled = row.filter(isFilled).map((cell) => cell.trim());
  const textCells = filled.filter((cell) => !looksLikeNumberOrDate(cell));
  const distinct = new Set(filled.map((cell) => cell.toLowerCase()));
  return textCells.length >= filled.length * 0.8 && distinct.size === filled.length;
}

function looksLikeNumberOrDate(cell: string): boolean {
  return /^[-+]?[\d.,\s%$€£]+$/.test(cell) || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(cell);
}
