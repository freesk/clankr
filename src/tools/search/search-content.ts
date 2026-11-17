// `search_content` (SRCH-3): literal or regex search inside text files, through the
// vendored ripgrep. Hits are files, ranked; each shows its first few matching lines.

import { stat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { z } from "zod";
import { defaultConfig } from "../../config/index.ts";
import type { ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { excludeParameters, excludeRulesFor } from "./excludes.ts";
import { countLabel, displayRoot, formatDate, relativeDisplay, truncateLine } from "./format.ts";
import { buildHitList } from "./hit-list.ts";
import { dropDeniedPaths, mapWithConcurrency, resolveExistingPath } from "./paths.ts";
import { contentMatchQuality, rankHits } from "./ranking.ts";
import { type FileMatches, runRipgrep } from "./ripgrep.ts";

/** Matching lines shown under each file. The rest are reachable with read_file. */
const linesShownPerFile = 3;
/** ripgrep stops counting a file's matches here; the hit then shows "20+". */
const matchesCountedPerFile = 20;
/** A search that matches more lines than this is too broad to rank usefully. */
const maxTotalMatches = 20_000;

const searchContentParameters = z.object({
  pattern: z.string().min(1).describe("Regex, or plain text if literal is true"),
  root: z.string().optional().describe("Folder or file. Default: working folder"),
  literal: z.boolean().optional(),
  case_sensitive: z.boolean().optional().describe("Default: only if pattern has capitals"),
  file_pattern: z.string().optional().describe('File name glob, e.g. "*.md"'),
  ...excludeParameters,
});

type SearchContentArguments = z.infer<typeof searchContentParameters>;

export const searchContentTool: ToolDefinition<typeof searchContentParameters> = {
  name: "search_content",
  description:
    "Search inside text files for a regex or literal text. Shows the best files first, with matching lines and line numbers.",
  parameters: searchContentParameters,
  permission: "read",
  resultTokenCap: defaultConfig().context.defaultResultTokenCap,
  groups: ["core"],
  keyArgument: "pattern",
  run: searchContent,
};

interface FileHit extends FileMatches {
  matchQuality: number;
  modifiedTimeMs: number;
  depth: number;
}

async function searchContent(args: SearchContentArguments, context: ToolContext) {
  const target = await resolveExistingPath(args.root ?? context.workingDirectory, context);
  const root = target.stats.isDirectory() ? target.realPath : dirname(target.realPath);
  const settings = context.config.search;
  const globs = excludeRulesFor(root, args).ripgrepGlobs();
  if (args.file_pattern) globs.unshift(args.file_pattern);

  const result = await runRipgrep({
    pattern: args.pattern,
    target: target.realPath,
    literal: args.literal === true,
    caseSensitive: args.case_sensitive,
    globs,
    maxLineLength: settings.maxLineLength,
    matchesPerFile: matchesCountedPerFile,
    maxTotalMatches,
    signal: context.signal,
  });

  const allowed = await dropDeniedPaths(result.files, context.paths);
  const ranked = rankHits(await withRankInputs(root, allowed));
  const matchCount = ranked.reduce((sum, file) => sum + file.lines.length, 0);
  const notes = result.truncated
    ? [
        `Note: stopped after ${countLabel(maxTotalMatches, "matching line")}. Narrow the pattern or root.`,
      ]
    : [];

  return buildHitList(
    {
      tool: "search_content",
      arguments: args,
      label: `search_content ${args.pattern} under ${displayRoot(root)}`,
      header: [
        `root ${displayRoot(root)} · ${countLabel(matchCount, "matching line")} in ${countLabel(ranked.length, "file")}, best first`,
      ],
      entries: ranked.map((file) => formatFileHit(root, file, settings.maxLineLength)),
      notes,
      cap: settings.maxHits,
      emptyMessage: "No matches.",
    },
    context,
  );
}

async function withRankInputs(root: string, files: FileMatches[]): Promise<FileHit[]> {
  return mapWithConcurrency(files, async (file) => {
    const modifiedTimeMs = await stat(file.path).then(
      (stats) => stats.mtimeMs,
      () => 0,
    );
    return {
      ...file,
      matchQuality: contentMatchQuality(file.lines.length),
      modifiedTimeMs,
      depth: relative(root, file.path).split(sep).length - 1,
    };
  });
}

/**
 * notes/plan.md (3) 2025-10-01
 *   12: the matching line
 */
function formatFileHit(root: string, file: FileHit, maxLineLength: number): string {
  const count =
    file.lines.length >= matchesCountedPerFile
      ? `${matchesCountedPerFile}+`
      : `${file.lines.length}`;
  const heading = `${relativeDisplay(root, file.path)} (${count}) ${formatDate(file.modifiedTimeMs)}`;
  const lines = file.lines
    .slice(0, linesShownPerFile)
    .map((line) => `  ${line.lineNumber}: ${truncateLine(line.text.trim(), maxLineLength)}`);
  return [heading, ...lines].join("\n");
}
