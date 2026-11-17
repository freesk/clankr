// Finding the text `edit_file` replaces: an exact match first, then a whitespace-tolerant
// match (FS-8), because small models often get indentation wrong. Every failure message
// tells the model what to do next.

import { ToolError } from "../../contracts/index.ts";

export interface Replacement {
  /** The whole file after the edit, with "\n" line endings. */
  text: string;
  matchCount: number;
  /** True when the exact match failed and the whitespace-tolerant fallback found the text. */
  whitespaceTolerant: boolean;
  /** 1-based line of the first replaced text. */
  firstLine: number;
}

export interface ReplacementRequest {
  /** File contents with "\n" line endings. */
  text: string;
  oldText: string;
  newText: string;
  replaceAll: boolean;
  displayName: string;
}

export function planReplacement(request: ReplacementRequest): Replacement {
  const { text, oldText, newText, replaceAll, displayName } = request;
  if (oldText === "") throw new ToolError("old is empty. Give the exact text to replace.");
  if (oldText === newText)
    throw new ToolError("old and new are the same, so nothing would change.");

  const positions = findAll(text, oldText);
  if (positions.length === 1 || (positions.length > 1 && replaceAll)) {
    return {
      text: text.split(oldText).join(newText),
      matchCount: positions.length,
      whitespaceTolerant: false,
      firstLine: lineNumberAt(text, positions[0] ?? 0),
    };
  }
  if (positions.length > 1) {
    throw new ToolError(
      `old was found ${positions.length} times in ${displayName}. Include more surrounding lines ` +
        "so it matches once, or set replace_all to true to change every occurrence.",
    );
  }
  return planTolerantReplacement(request);
}

function findAll(text: string, search: string): number[] {
  const positions: number[] = [];
  let index = text.indexOf(search);
  while (index !== -1) {
    positions.push(index);
    index = text.indexOf(search, index + search.length);
  }
  return positions;
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Compares lines ignoring indentation, trailing spaces, and runs of inner whitespace. */
function canonicalLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

/** Drops blank lines at both ends, which a model often adds or leaves out. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

function planTolerantReplacement(request: ReplacementRequest): Replacement {
  const { text, displayName } = request;
  const fileLines = text.split("\n");
  const oldLines = trimBlankLines(request.oldText.split("\n"));
  const starts = oldLines.length === 0 ? [] : findLineWindows(fileLines, oldLines);

  if (starts.length === 0) {
    throw new ToolError(
      `old was not found in ${displayName}, even ignoring whitespace. Call read_file on the ` +
        "surrounding lines and copy the text exactly.",
    );
  }
  if (starts.length > 1) {
    throw new ToolError(
      `old was not found exactly, and ignoring whitespace it matches ${starts.length} places in ` +
        `${displayName}. Call read_file and copy the text exactly, with more surrounding lines.`,
    );
  }

  const start = starts[0] ?? 0;
  const newLines = reindent(
    trimBlankLines(request.newText.split("\n")),
    leadingWhitespace(oldLines[0] ?? ""),
    leadingWhitespace(fileLines[start] ?? ""),
  );
  fileLines.splice(start, oldLines.length, ...newLines);
  return {
    text: fileLines.join("\n"),
    matchCount: 1,
    whitespaceTolerant: true,
    firstLine: start + 1,
  };
}

function findLineWindows(fileLines: string[], searchLines: string[]): number[] {
  const wanted = searchLines.map(canonicalLine);
  const canonicalFile = fileLines.map(canonicalLine);
  const starts: number[] = [];
  for (let start = 0; start + wanted.length <= canonicalFile.length; start++) {
    if (wanted.every((line, offset) => canonicalFile[start + offset] === line)) starts.push(start);
  }
  return starts;
}

function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

/**
 * The model wrote `new` with the same wrong indentation as `old`, so shift each line by the
 * difference between the indentation it used and the indentation the file really has.
 */
function reindent(lines: string[], modelIndent: string, fileIndent: string): string[] {
  return lines.map((line) => {
    if (line.trim() === "") return line;
    if (line.startsWith(modelIndent)) return fileIndent + line.slice(modelIndent.length);
    return line;
  });
}
