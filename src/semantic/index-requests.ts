// Runs one index request for `clankr index` and `/index`: list the indexed folders, build or
// update one, or remove one. Problems the user can fix are printed with their fix and reported
// as "failed"; only a bug is thrown.

import { stat } from "node:fs/promises";
import type {
  Config,
  IndexOutcome,
  IndexRequest,
  IndexRunOptions,
  LmClient,
  PathPolicy,
} from "../contracts/index.ts";
import { displayRoot } from "../tools/search/format.ts";
import { buildIndex } from "./build-index.ts";
import { describeIndexFailure } from "./errors.ts";
import type { Extractors } from "./extract/index.ts";
import {
  type IndexedFolder,
  readIndexCatalog,
  removeIndexedFolder,
  scopeFor,
} from "./index-catalog.ts";
import { statusText, summaryText } from "./index-report.ts";

export interface IndexEnvironment extends IndexRunOptions {
  config: Config;
  /** Embeds the passages. Only a build uses it. */
  lm: LmClient;
  /** The deny list (PERM-4): a protected folder is refused, a protected file left out. */
  paths: PathPolicy;
  /** `ClankrPaths.indexDirectory`. */
  indexDirectory: string;
  /** Replaces the real extractors in tests. */
  extractors?: Extractors;
  now?(): Date;
}

export async function runIndexRequest(
  request: IndexRequest,
  environment: IndexEnvironment,
): Promise<IndexOutcome> {
  try {
    if (request.action === "status") return await showStatus(environment);
    if (request.action === "remove") return await removeFolder(request.folder, environment);
    return await buildFolder(request.folder, request.rebuild, environment);
  } catch (error) {
    if (environment.signal.aborted) {
      environment.print("Indexing cancelled.");
      return "cancelled";
    }
    const problem = describeIndexFailure(error);
    if (problem === undefined) throw error;
    environment.print(problem);
    return "failed";
  }
}

async function showStatus(environment: IndexEnvironment): Promise<IndexOutcome> {
  const catalog = await readIndexCatalog(environment.indexDirectory);
  environment.print(statusText(catalog, environment.config, environment.now?.()));
  return "done";
}

async function removeFolder(folder: string, environment: IndexEnvironment): Promise<IndexOutcome> {
  const { realPath } = await environment.paths.classify(folder);
  if (await removeIndexedFolder(environment.indexDirectory, realPath)) {
    environment.print(`Removed the index of ${displayRoot(realPath)}.`);
    return "done";
  }
  const { folders } = await readIndexCatalog(environment.indexDirectory);
  const indexed = folders.map((candidate) => displayRoot(candidate.root)).join(", ");
  environment.print(
    `${folder} is not indexed. ${indexed ? `Indexed folders: ${indexed}.` : "Nothing is indexed."}`,
  );
  return "failed";
}

async function buildFolder(
  folder: string,
  rebuild: boolean,
  environment: IndexEnvironment,
): Promise<IndexOutcome> {
  const { realPath, pathClass } = await environment.paths.classify(folder);
  const refusal =
    (await folderProblem(folder, realPath, pathClass === "denied")) ??
    overlapProblem(realPath, (await readIndexCatalog(environment.indexDirectory)).folders);
  if (refusal) {
    environment.print(refusal);
    return "failed";
  }
  const summary = await buildIndex({
    root: realPath,
    rebuild,
    indexDirectory: environment.indexDirectory,
    config: environment.config,
    lm: environment.lm,
    paths: environment.paths,
    signal: environment.signal,
    onProgress: environment.showProgress,
    ...(environment.extractors ? { extractors: environment.extractors } : {}),
    ...(environment.now ? { now: environment.now } : {}),
  });
  environment.print(summaryText(summary));
  return summary.cancelled ? "cancelled" : "done";
}

async function folderProblem(
  folder: string,
  realPath: string,
  denied: boolean,
): Promise<string | undefined> {
  if (denied) return `${folder} is protected and cannot be indexed.`;
  const stats = await stat(realPath).catch(() => undefined);
  if (!stats) return `${folder} does not exist.`;
  if (!stats.isDirectory()) return `${folder} is a file. Index the folder that contains it.`;
  return undefined;
}

/**
 * Two indexes over the same files would return every passage twice, so a folder inside an
 * indexed folder, or around one, is refused with the way out.
 */
function overlapProblem(root: string, folders: IndexedFolder[]): string | undefined {
  for (const folder of folders) {
    if (folder.root === root) continue;
    const other = displayRoot(folder.root);
    if (scopeFor(folder.root, root)?.under !== undefined) {
      return `${displayRoot(root)} is inside ${other}, which is already indexed. Run \`clankr index ${other}\` to bring that index up to date.`;
    }
    if (scopeFor(root, folder.root)?.under !== undefined) {
      return `${displayRoot(root)} contains ${other}, which has its own index. Remove that one first with \`clankr index --remove ${other}\`.`;
    }
  }
  return undefined;
}
