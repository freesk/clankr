// `search_meaning` (SRCH-9): finds passages by meaning in the folders the user has indexed.
// Read-only, in its own `semantic` group, which the harness offers only while an index exists
// (D80). The model cannot build or change an index; only the user can, with `/index`.

import { z } from "zod";
import {
  type Config,
  type ToolContext,
  type ToolDefinition,
  ToolError,
  type ToolOutput,
} from "../contracts/index.ts";
import { countLabel, displayRoot } from "../tools/search/format.ts";
import { buildHitList } from "../tools/search/hit-list.ts";
import { resolveExistingPath } from "../tools/search/paths.ts";
import { describeIndexFailure } from "./errors.ts";
import { changedMarker, formatAge, formatPassage } from "./format-passages.ts";
import { type IndexCatalog, type IndexedFolder, readIndexCatalog } from "./index-catalog.ts";
import {
  type FolderSearch,
  type FolderTarget,
  searchFolders,
  targetsFor,
} from "./search-folders.ts";

export const searchMeaningToolName = "search_meaning";

const searchMeaningParameters = z.object({
  query: z.string().min(1).describe("What to find, in plain words"),
  root: z.string().optional().describe("Indexed folder. Default: all"),
});

type SearchMeaningArguments = z.infer<typeof searchMeaningParameters>;

/** What the model can do instead, appended to every error. */
const fallbackAdvice = "Use search_content for exact words meanwhile.";

export function createSearchMeaningTool(
  config: Config,
): ToolDefinition<typeof searchMeaningParameters> {
  return {
    name: searchMeaningToolName,
    description:
      "Find passages by meaning in the folders the user indexed, for when the exact words are unknown. Shows the best passages first, with path and lines or page.",
    parameters: searchMeaningParameters,
    permission: "read",
    resultTokenCap: config.context.defaultResultTokenCap,
    groups: ["semantic"],
    keyArgument: "query",
    run: searchMeaning,
  };
}

async function searchMeaning(
  args: SearchMeaningArguments,
  context: ToolContext,
): Promise<ToolOutput> {
  const scopePath =
    args.root === undefined ? undefined : (await resolveExistingPath(args.root, context)).realPath;
  const catalog = await readIndexCatalog(context.clankrPaths.indexDirectory);
  if (catalog.folders.length === 0) throw new ToolError(nothingToSearchMessage(catalog));
  const targets = targetsFor(catalog.folders, scopePath);
  if (targets.length === 0) throw new ToolError(notIndexedMessage(args.root, catalog.folders));

  const search = await runSearch(args.query, targets, context);
  if (search.searched.length === 0) throw new ToolError(needRebuildMessage(search));

  const settings = context.config.search;
  return buildHitList(
    {
      tool: searchMeaningToolName,
      arguments: args,
      label: `${searchMeaningToolName} "${args.query}"`,
      header: [headerLine(search, scopePath)],
      entries: search.hits.map((hit) =>
        formatPassage(hit, context.workingDirectory, settings.meaningSnippetCharacters),
      ),
      notes: [...notesFor(search), ...unreadableNotes(catalog)],
      cap: settings.meaningMaxHits,
      emptyMessage: "No passages: the index holds no text.",
    },
    context,
  );
}

async function runSearch(
  query: string,
  targets: FolderTarget[],
  context: ToolContext,
): Promise<FolderSearch> {
  try {
    return await searchFolders({
      query,
      targets,
      config: context.config,
      lm: context.lm,
      paths: context.paths,
      signal: context.signal,
    });
  } catch (error) {
    if (context.signal.aborted) throw error;
    const problem = describeIndexFailure(error);
    if (problem === undefined) throw error;
    throw new ToolError(`${problem.replace(/\s*\n\s*/g, " ")} ${fallbackAdvice}`);
  }
}

/** root ~/Documents/contracts · 23 passages, best first · indexed 2 days ago */
function headerLine(search: FolderSearch, scopePath: string | undefined): string {
  const [only] = search.searched;
  const where =
    search.searched.length === 1 && only
      ? `root ${displayRoot(scopePath ?? only.root)}`
      : `${search.searched.length} indexed folders`;
  return `${where} · ${countLabel(search.hits.length, "passage")}, best first · ${ageLabel(search.searched)}`;
}

/** The oldest index decides, since any hit may come from it. */
function ageLabel(folders: IndexedFolder[]): string {
  const times = folders.map((folder) => folder.updatedAt).filter((time) => time !== undefined);
  if (times.length < folders.length) return "indexing unfinished";
  const oldest = times.sort()[0] as string;
  return `${folders.length > 1 ? "oldest index" : "indexed"} ${formatAge(oldest)}`;
}

function notesFor(search: FolderSearch): string[] {
  const notes: string[] = [];
  if (search.hits.some((hit) => hit.changedSinceIndexed)) {
    notes.push(
      `Note: ${changedMarker} files were edited after indexing; read them before relying on a passage.`,
    );
  }
  if (search.missingFiles > 0) {
    notes.push(
      `Note: left out ${countLabel(search.missingFiles, "passage")} from files that no longer exist.`,
    );
  }
  for (const folder of search.searched.filter((candidate) => !candidate.complete)) {
    notes.push(
      `Note: indexing of ${displayRoot(folder.root)} did not finish, so some files are missing. The user can run /index again.`,
    );
  }
  for (const { folder } of search.needRebuild) {
    notes.push(
      `Note: skipped ${displayRoot(folder.root)}; its index needs a rebuild by the user (/index --rebuild).`,
    );
  }
  return notes;
}

function unreadableNotes(catalog: IndexCatalog): string[] {
  return catalog.unreadable.map((index) => `Note: one index was not searched: ${index.problem}.`);
}

/** Nothing indexed, or the only indexes are unreadable (a `clankr index` run holds them). */
function nothingToSearchMessage(catalog: IndexCatalog): string {
  const [unreadable] = catalog.unreadable;
  if (unreadable) {
    return `The search index cannot be read right now: ${unreadable.problem}. ${fallbackAdvice}`;
  }
  return `No folder is indexed. Only the user can index one, with /index <folder>. ${fallbackAdvice}`;
}

function notIndexedMessage(root: string | undefined, folders: IndexedFolder[]): string {
  const indexed = folders.map((folder) => displayRoot(folder.root)).join(", ");
  return `${root} is not indexed. Indexed folders: ${indexed}. Search one of them, or tell the user to run /index ${root}. ${fallbackAdvice}`;
}

/** Every folder the call covers was built with another embedding model. */
function needRebuildMessage(search: FolderSearch): string {
  const reason = search.needRebuild[0]?.reason.message ?? "The index needs a rebuild.";
  return `${reason} Only the user can do that; tell them. ${fallbackAdvice}`;
}
