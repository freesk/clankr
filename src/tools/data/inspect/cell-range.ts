// Spreadsheet cell references: "A1:F1200" to numbers and back.

export interface CellRange {
  firstColumn: number;
  firstRow: number;
  lastColumn: number;
  lastRow: number;
}

export function parseCellRange(reference: string): CellRange | undefined {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(reference);
  if (!match) return undefined;
  const [, firstLetters = "A", firstRowText = "1", lastLetters, lastRowText] = match;
  return {
    firstColumn: columnNumber(firstLetters),
    firstRow: Number(firstRowText),
    lastColumn: columnNumber(lastLetters ?? firstLetters),
    lastRow: Number(lastRowText ?? firstRowText),
  };
}

export function formatCellRange(range: CellRange): string {
  return `${columnLetters(range.firstColumn)}${range.firstRow}:${columnLetters(range.lastColumn)}${range.lastRow}`;
}

/** "A" is 1, "Z" is 26, "AA" is 27. */
export function columnNumber(letters: string): number {
  let number = 0;
  for (const letter of letters) number = number * 26 + (letter.charCodeAt(0) - 64);
  return number;
}

export function columnLetters(number: number): string {
  let letters = "";
  for (let remaining = number; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    letters = String.fromCharCode(65 + ((remaining - 1) % 26)) + letters;
  }
  return letters;
}
