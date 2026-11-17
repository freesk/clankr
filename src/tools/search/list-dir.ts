// `list_dir` (SRCH-4): one folder's entries with type, size, and modified date, or a
// depth-limited tree. Excluded folders are listed but not opened, so the model knows
// they exist without paying for their contents. There is no per-call override: to see
// inside one, the model lists it by path, and a root inside an excluded folder is listed
// normally. Leaving the override out saves fixed overhead on every request (CTX-5).

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { defaultConfig } from "../../config/index.ts";
import type { ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { type ExcludeRules, excludeRulesFor } from "./excludes.ts";
import { countLabel, displayRoot, formatDate, formatSize } from "./format.ts";
import { buildHitList } from "./hit-list.ts";
import { mapWithConcurrency, resolveFolder } from "./paths.ts";

const maxDepth = 5;
/** A deep tree of a large folder can hold millions of entries; stop opening folders here. */
const maxTreeEntries = 10_000;

const listDirParameters = z.object({
  path: z.string().optional().describe("Default: working folder"),
  depth: z
    .number()
    .int()
    .min(1)
    .max(maxDepth)
    .optional()
    .describe(`1-${maxDepth}; above 1 shows a tree`),
});

type ListDirArguments = z.infer<typeof listDirParameters>;

export const listDirTool: ToolDefinition<typeof listDirParameters> = {
  name: "list_dir",
  description: "List a folder's entries with size and modified date. Folders end in /.",
  parameters: listDirParameters,
  permission: "read",
  resultTokenCap: defaultConfig().context.defaultResultTokenCap,
  groups: ["core"],
  keyArgument: "path",
  run: listDir,
};

interface Listing {
  lines: string[];
  hidden: { denied: number; unreadable: number };
  /** Set when the tree grew past `maxTreeEntries` and deeper folders were not opened. */
  truncated?: boolean;
}

/** Everything one `list_dir` call carries down the tree. */
interface ListingRun {
  root: string;
  depth: number;
  excludes: ExcludeRules;
  context: ToolContext;
  listing: Listing;
}

async function listDir(args: ListDirArguments, context: ToolContext) {
  const root = await resolveFolder(args.path ?? context.workingDirectory, context);
  const listing: Listing = { lines: [], hidden: { denied: 0, unreadable: 0 } };
  const run: ListingRun = {
    root,
    depth: args.depth ?? 1,
    excludes: excludeRulesFor(root, {}),
    context,
    listing,
  };
  await listFolder(run, root, 1);

  return buildHitList(
    {
      tool: "list_dir",
      arguments: args,
      label: `list_dir ${displayRoot(root)}`,
      header: [`${displayRoot(root)}/ · ${countLabel(listing.lines.length, "entry", "entries")}`],
      entries: listing.lines,
      notes: listingNotes(listing),
      cap: context.config.search.maxListEntries,
      emptyMessage: "The folder is empty.",
    },
    context,
  );
}

async function listFolder(run: ListingRun, folder: string, level: number): Promise<void> {
  const { listing } = run;
  if (listing.lines.length >= maxTreeEntries) {
    listing.truncated = true;
    return;
  }
  let dirents: Dirent[];
  try {
    dirents = await readdir(folder, { withFileTypes: true });
  } catch {
    listing.hidden.unreadable++;
    return;
  }
  // Folders first, then files, each alphabetical: the order people expect from a listing.
  dirents.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
  );
  const entries = await describeEntries(folder, dirents, run.context);
  const indent = "  ".repeat(level - 1);

  for (const entry of entries) {
    if (entry.denied) {
      listing.hidden.denied++;
      continue;
    }
    const excluded = run.excludes.isExcluded(relative(run.root, entry.path));
    // Excluded files (.DS_Store and the like) are pure noise in a listing; drop them.
    if (excluded && !entry.isDirectory) continue;
    listing.lines.push(indent + entry.line + (excluded && entry.isDirectory ? "  (skipped)" : ""));
    if (entry.isDirectory && !excluded && level < run.depth) {
      await listFolder(run, entry.path, level + 1);
    }
  }
}

interface DescribedEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  denied: boolean;
  line: string;
}

async function describeEntries(
  folder: string,
  dirents: Dirent[],
  context: ToolContext,
): Promise<DescribedEntry[]> {
  return mapWithConcurrency(dirents, async (dirent) => {
    const path = join(folder, dirent.name);
    const { pathClass } = await context.paths.classify(path);
    const isDirectory = dirent.isDirectory();
    const line = await entryLine(path, dirent, isDirectory);
    return { path, name: dirent.name, isDirectory, denied: pathClass === "denied", line };
  });
}

/** "photos/  2025-03-04", "notes.md  4 KB  2025-03-04", "latest -> link". */
async function entryLine(path: string, dirent: Dirent, isDirectory: boolean): Promise<string> {
  if (dirent.isSymbolicLink()) return `${dirent.name} -> link`;
  try {
    const stats = await stat(path);
    const date = formatDate(stats.mtimeMs);
    return isDirectory
      ? `${dirent.name}/  ${date}`
      : `${dirent.name}  ${formatSize(stats.size)}  ${date}`;
  } catch {
    return isDirectory ? `${dirent.name}/` : dirent.name;
  }
}

function listingNotes({ hidden, truncated }: Listing): string[] {
  const notes: string[] = [];
  if (truncated) {
    notes.push(
      `The tree stopped at ${countLabel(maxTreeEntries, "entry", "entries")}. Use a smaller depth.`,
    );
  }
  if (hidden.denied > 0)
    notes.push(`${countLabel(hidden.denied, "protected entry", "protected entries")} not shown.`);
  if (hidden.unreadable > 0)
    notes.push(`${countLabel(hidden.unreadable, "folder")} could not be opened.`);
  return notes;
}
