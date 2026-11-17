// What is indexed: every index file's folder, counts, age, and embedding model. Each index
// describes itself (its meta table), so there is no separate catalog file to drift from it.

import { relative, sep } from "node:path";
import { isLockConflict } from "./index-database.ts";
import { deleteIndexFile, indexFileFor, listIndexFiles } from "./index-location.ts";
import { type IndexMeta, IndexStore } from "./index-store.ts";

export interface IndexedFolder extends IndexMeta {
  indexFile: string;
  /** Files with passages. */
  fileCount: number;
  passageCount: number;
}

/** An index file that could not be read, with the reason. */
export interface UnreadableIndex {
  indexFile: string;
  problem: string;
}

export interface IndexCatalog {
  folders: IndexedFolder[];
  unreadable: UnreadableIndex[];
}

/** Opens every index read-only, one at a time. Folders are sorted by path. */
export async function readIndexCatalog(indexDirectory: string): Promise<IndexCatalog> {
  const catalog: IndexCatalog = { folders: [], unreadable: [] };
  for (const indexFile of await listIndexFiles(indexDirectory)) {
    try {
      const folder = await describeIndex(indexFile);
      if (folder) catalog.folders.push(folder);
    } catch (error) {
      catalog.unreadable.push({ indexFile, problem: problemText(error) });
    }
  }
  catalog.folders.sort((a, b) => a.root.localeCompare(b.root));
  return catalog;
}

/** Deletes the index of exactly this folder. False when the folder was not indexed. */
export async function removeIndexedFolder(indexDirectory: string, root: string): Promise<boolean> {
  const indexFile = indexFileFor(indexDirectory, root);
  if (!(await listIndexFiles(indexDirectory)).includes(indexFile)) return false;
  await deleteIndexFile(indexFile);
  return true;
}

/** The part of an indexed folder a search covers. `under` absent means all of it. */
export interface IndexScope {
  /** A file or folder path relative to the index root, with "/" separators. */
  under?: string;
}

/**
 * The scope a path selects in an indexed folder: part of it when the path lies inside the
 * folder, all of it when the path is the folder or contains it, undefined when unrelated.
 */
export function scopeFor(folderRoot: string, path: string): IndexScope | undefined {
  const inside = relative(folderRoot, path);
  if (inside === "") return {};
  if (!inside.startsWith("..")) return { under: inside.split(sep).join("/") };
  return relative(path, folderRoot).startsWith("..") ? undefined : {};
}

async function describeIndex(indexFile: string): Promise<IndexedFolder | undefined> {
  const store = await IndexStore.open(indexFile, "read");
  try {
    const meta = await store.readMeta();
    // A file left by a run that was killed before it wrote anything.
    if (!meta) return undefined;
    const counts = await store.counts();
    return { ...meta, indexFile, fileCount: counts.files, passageCount: counts.chunks };
  } finally {
    await store.close();
  }
}

function problemText(error: unknown): string {
  if (isLockConflict(error)) return "another clankr process is updating it; try again shortly";
  return error instanceof Error ? (error.message.split("\n")[0] ?? "unreadable") : "unreadable";
}
