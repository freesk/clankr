// `find_files` (SRCH-1, SRCH-2): name, type, size, and date search across the machine.
// Defaults to the home folder (D24); "/" searches everything.

import { homedir } from "node:os";
import { relative, sep } from "node:path";
import { z } from "zod";
import { defaultConfig } from "../../config/index.ts";
import type { ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { excludeParameters, excludeRulesFor } from "./excludes.ts";
import { parseCriteria } from "./file-criteria.ts";
import { fileKinds } from "./file-kinds.ts";
import { type FoundEntry, searchFiles } from "./file-search.ts";
import { countLabel, displayRoot, formatDate, formatSize, relativeDisplay } from "./format.ts";
import { buildHitList } from "./hit-list.ts";
import { dropDeniedPaths, resolveFolder } from "./paths.ts";
import { nameMatchQuality, rankHits } from "./ranking.ts";
import { macSpotlight, type SpotlightIndex } from "./spotlight.ts";

const findFilesParameters = z.object({
  pattern: z.string().optional().describe('Name glob like "*.pdf", or text in the name'),
  root: z.string().optional().describe('Default: home folder. "/" searches the whole disk'),
  type: z.enum(fileKinds).optional(),
  min_size: z.string().optional(),
  max_size: z.string().optional(),
  modified_after: z.string().optional(),
  modified_before: z.string().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  ...excludeParameters,
});

type FindFilesArguments = z.infer<typeof findFilesParameters>;

export function createFindFilesTool(
  spotlight: SpotlightIndex = macSpotlight,
): ToolDefinition<typeof findFilesParameters> {
  return {
    name: "find_files",
    description:
      'Find files and folders by name, type, size, or date, best first. Sizes like "10MB"; dates like "2025-01-31" or an age like "7d".',
    parameters: findFilesParameters,
    permission: "read",
    resultTokenCap: defaultConfig().context.defaultResultTokenCap,
    groups: ["core"],
    keyArgument: "pattern",
    run: (args, context) => findFiles(args, context, spotlight),
  };
}

export const findFilesTool = createFindFilesTool();

async function findFiles(
  args: FindFilesArguments,
  context: ToolContext,
  spotlight: SpotlightIndex,
) {
  const root = await resolveFolder(args.root ?? homedir(), context);
  const criteria = parseCriteria(args);
  const settings = context.config.search;
  const result = await searchFiles({
    root,
    criteria,
    excludes: excludeRulesFor(root, args),
    signal: context.signal,
    spotlight,
    limits: settings,
  });

  const allowed = await dropDeniedPaths(result.entries, context.paths);
  const ranked = rankHits(
    allowed.map((entry) => ({
      ...entry,
      matchQuality: nameMatchQuality(entry.name, criteria.pattern),
      modifiedTimeMs: entry.stats.mtimeMs,
      depth: relative(root, entry.path).split(sep).length - 1,
    })),
  );

  return buildHitList(
    {
      tool: "find_files",
      arguments: args,
      label: `find_files ${args.pattern ?? args.type ?? "*"} under ${displayRoot(root)}`,
      header: [
        `root ${displayRoot(root)} · ${countLabel(ranked.length, "match", "matches")} via ${result.method}, best first`,
      ],
      entries: ranked.map((entry) => formatEntry(root, entry)),
      notes: result.notes,
      cap: settings.maxHits,
      emptyMessage: "No matches.",
    },
    context,
  );
}

/** "reports/q3.pdf  1.2 MB  2025-10-01"; folders end in "/" and show no size. */
function formatEntry(root: string, entry: FoundEntry): string {
  const path = relativeDisplay(root, entry.path);
  const date = formatDate(entry.stats.mtimeMs);
  if (entry.stats.isDirectory()) return `${path}/  ${date}`;
  return `${path}  ${formatSize(entry.stats.size)}  ${date}`;
}
