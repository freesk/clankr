// Runs the vendored ripgrep (SRCH-3, SEC-3) and groups its matches by file.
// The binary comes from `npm run vendor`; nothing is fetched or looked up on PATH.

import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { ToolError } from "../../contracts/index.ts";
import { runProcess } from "./run-process.ts";

/** vendor/ripgrep/rg, found the same way from src/ and from the built dist/. */
export const ripgrepBinaryPath = resolve(import.meta.dirname, "../../../vendor/ripgrep/rg");

export interface MatchedLine {
  lineNumber: number;
  text: string;
}

export interface FileMatches {
  path: string;
  lines: MatchedLine[];
}

export interface RipgrepRequest {
  pattern: string;
  target: string;
  literal: boolean;
  caseSensitive: boolean | undefined;
  globs: string[];
  maxLineLength: number;
  matchesPerFile: number;
  /** Stop reading after this many matched lines in total. */
  maxTotalMatches: number;
  signal: AbortSignal;
}

export interface RipgrepResult {
  files: FileMatches[];
  /** True when `maxTotalMatches` stopped the search early. */
  truncated: boolean;
}

export async function runRipgrep(request: RipgrepRequest): Promise<RipgrepResult> {
  await ensureRipgrepInstalled();
  const byPath = new Map<string, FileMatches>();
  let total = 0;
  const run = await runProcess(ripgrepBinaryPath, ripgrepArguments(request), {
    signal: request.signal,
    onRecord(record) {
      const match = parseRecord(record);
      if (!match) return true;
      let file = byPath.get(match.path);
      if (!file) {
        file = { path: match.path, lines: [] };
        byPath.set(match.path, file);
      }
      file.lines.push(match.line);
      total++;
      return total < request.maxTotalMatches;
    },
  });
  // Exit code 1 means "no match"; 2 means an error, which matters only when nothing matched.
  if (run.exitCode === 2 && byPath.size === 0 && !run.stopped) throw ripgrepError(run.stderr);
  return { files: [...byPath.values()], truncated: run.stopped };
}

function ripgrepArguments(request: RipgrepRequest): string[] {
  const args = [
    "--no-config",
    "--line-number",
    "--with-filename",
    "--null",
    "--no-heading",
    "--color=never",
    // Our own excludes replace .gitignore, so every search path skips the same things.
    "--no-ignore",
    "--hidden",
    "--no-messages",
    `--max-count=${request.matchesPerFile}`,
    `--max-columns=${request.maxLineLength}`,
    "--max-columns-preview",
  ];
  if (request.literal) args.push("--fixed-strings");
  if (request.caseSensitive === true) args.push("--case-sensitive");
  else if (request.caseSensitive === false) args.push("--ignore-case");
  else args.push("--smart-case");
  for (const glob of request.globs) args.push(`--glob=${glob}`);
  args.push(`--regexp=${request.pattern}`, "--", request.target);
  return args;
}

/** One output line: "path\0lineNumber:text". */
function parseRecord(record: string): { path: string; line: MatchedLine } | undefined {
  const separator = record.indexOf("\0");
  if (separator === -1) return undefined;
  const rest = record.slice(separator + 1);
  const colon = rest.indexOf(":");
  const lineNumber = Number.parseInt(rest.slice(0, colon), 10);
  if (colon === -1 || Number.isNaN(lineNumber)) return undefined;
  return {
    path: record.slice(0, separator),
    line: { lineNumber, text: rest.slice(colon + 1).replace(/\r$/, "") },
  };
}

function ripgrepError(stderr: string): ToolError {
  const firstLines = stderr.trim().split("\n").slice(0, 6).join("\n");
  if (/regex parse error/i.test(stderr)) {
    return new ToolError(
      `The pattern is not a valid regex:\n${firstLines}\nFix it, or pass literal: true to search for the text as written.`,
    );
  }
  return new ToolError(`Content search failed: ${firstLines}`);
}

async function ensureRipgrepInstalled(): Promise<void> {
  try {
    await access(ripgrepBinaryPath, constants.X_OK);
  } catch {
    throw new ToolError(
      "Content search is unavailable because ripgrep is not installed. Tell the user to run `npm run vendor` in the clankr folder.",
    );
  }
}
