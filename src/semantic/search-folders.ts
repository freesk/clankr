// One meaning search across the indexed folders a call covers: pick the folders, embed the
// query once, ask each index for its best passages, and merge them by similarity.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Config, LmClient, PathPolicy } from "../contracts/index.ts";
import { displayRoot } from "../tools/search/format.ts";
import { dropDeniedPaths, mapWithConcurrency } from "../tools/search/paths.ts";
import { Embedder } from "./embedder.ts";
import { dimensionMismatch, indexInUse, modelMismatch, type SearchIndexError } from "./errors.ts";
import type { PassageHit } from "./format-passages.ts";
import { type IndexedFolder, type IndexScope, scopeFor } from "./index-catalog.ts";
import { isLockConflict } from "./index-database.ts";
import { searchPassages } from "./index-search.ts";
import { IndexStore } from "./index-store.ts";

/** Passages shown from one file, so one long document cannot fill the list. */
const passagesPerFile = 3;

export interface FolderTarget {
  folder: IndexedFolder;
  scope: IndexScope;
}

export interface FolderSearch {
  /** Best first, at most `search.maxHits`. */
  hits: PassageHit[];
  /** Folders whose passages were compared with the query. */
  searched: IndexedFolder[];
  /** Folders left out because their vectors do not fit the configured embedding model. */
  needRebuild: { folder: IndexedFolder; reason: SearchIndexError }[];
  /** Hits dropped because their file no longer exists. */
  missingFiles: number;
}

/** The indexed folders a path selects; every folder when no path is given. */
export function targetsFor(
  folders: IndexedFolder[],
  scopePath: string | undefined,
): FolderTarget[] {
  if (scopePath === undefined) return folders.map((folder) => ({ folder, scope: {} }));
  return folders.flatMap((folder) => {
    const scope = scopeFor(folder.root, scopePath);
    return scope ? [{ folder, scope }] : [];
  });
}

export interface FolderSearchOptions {
  query: string;
  targets: FolderTarget[];
  config: Config;
  lm: LmClient;
  paths: PathPolicy;
  signal: AbortSignal;
}

export async function searchFolders(options: FolderSearchOptions): Promise<FolderSearch> {
  const embedder = new Embedder(options.lm, options.config);
  const usable = options.targets.filter(
    (target) => target.folder.embeddingModel === embedder.model,
  );
  const needRebuild = options.targets
    .filter((target) => !usable.includes(target))
    .map(({ folder }) => ({
      folder,
      reason: modelMismatch(displayRoot(folder.root), folder.embeddingModel, embedder.model),
    }));
  const result: FolderSearch = { hits: [], searched: [], needRebuild, missingFiles: 0 };
  // Nothing to compare the query with, so LM Studio is not asked at all.
  if (usable.length === 0) return result;

  const vector = await embedder.embedQuery(options.query, options.signal);
  const limit = options.config.search.maxHits;
  const found: StoredHit[] = [];
  for (const target of usable) {
    const { folder } = target;
    // A folder indexed before any file had text has no passage table to search.
    if (folder.dimensions === undefined) {
      result.searched.push(folder);
    } else if (folder.dimensions !== vector.length) {
      // Same model name, other vector size: a different build of the model.
      const reason = dimensionMismatch(displayRoot(folder.root), folder.dimensions, vector.length);
      result.needRebuild.push({ folder, reason });
    } else {
      found.push(...(await searchOneFolder(target, vector, limit)));
      result.searched.push(folder);
    }
  }
  found.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  // Checked again at query time: a file protected after it was indexed is not shown.
  const allowed = await dropDeniedPaths(found.slice(0, limit), options.paths);
  const current = await mapWithConcurrency(allowed, withFreshness);
  result.hits = current.filter((hit): hit is PassageHit => hit !== undefined);
  result.missingFiles = current.length - result.hits.length;
  return result;
}

/** A hit with the size and modified time its file had when indexed, to tell if it changed. */
interface StoredHit extends PassageHit {
  indexedSizeBytes: number;
  indexedModifiedMs: number;
}

async function searchOneFolder(
  target: FolderTarget,
  vector: number[],
  limit: number,
): Promise<StoredHit[]> {
  const store = await openForReading(target.folder);
  try {
    const passages = await searchPassages(store, {
      vector,
      limit,
      perFile: passagesPerFile,
      ...(target.scope.under === undefined ? {} : { under: target.scope.under }),
    });
    return passages.map((passage) => ({
      path: join(target.folder.root, passage.path),
      startLine: passage.startLine,
      endLine: passage.endLine,
      page: passage.page,
      text: passage.text,
      score: passage.score,
      changedSinceIndexed: false,
      indexedSizeBytes: passage.indexedSizeBytes,
      indexedModifiedMs: passage.indexedModifiedMs,
    }));
  } finally {
    await store.close();
  }
}

async function openForReading(folder: IndexedFolder): Promise<IndexStore> {
  try {
    return await IndexStore.open(folder.indexFile, "read");
  } catch (error) {
    // An indexing run in another process started after the catalog was read.
    throw isLockConflict(error) ? indexInUse(displayRoot(folder.root)) : error;
  }
}

/** Marks a hit whose file was edited after indexing; undefined when the file is gone. */
async function withFreshness(hit: StoredHit): Promise<PassageHit | undefined> {
  const stats = await stat(hit.path).catch(() => undefined);
  if (!stats) return undefined;
  const { indexedSizeBytes, indexedModifiedMs, ...shown } = hit;
  const changed =
    stats.size !== indexedSizeBytes || Math.floor(stats.mtimeMs) !== indexedModifiedMs;
  return { ...shown, changedSinceIndexed: changed };
}
