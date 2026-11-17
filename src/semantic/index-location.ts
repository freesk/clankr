// Where the indexes live: one DuckDB file per indexed folder, inside the directory that
// `ClankrPaths.indexDirectory` names. Nothing here loads DuckDB, so asking "is anything
// indexed?" on every turn costs one directory listing.

import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const indexFileExtension = ".duckdb";
/** DuckDB's write-ahead log, present only while a writer is open or after a crash. */
const writeAheadLogSuffix = ".wal";

/** Named by a hash of the folder's real path, so any folder name is safe as a file name. */
export function indexFileFor(indexDirectory: string, root: string): string {
  const name = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(indexDirectory, `${name}${indexFileExtension}`);
}

export function writeAheadLogOf(indexFile: string): string {
  return `${indexFile}${writeAheadLogSuffix}`;
}

/** Every index file, sorted so listings are stable. A missing directory means none. */
export async function listIndexFiles(indexDirectory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(indexDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(indexFileExtension))
    .sort()
    .map((name) => join(indexDirectory, name));
}

export async function hasSearchIndex(indexDirectory: string): Promise<boolean> {
  return (await listIndexFiles(indexDirectory)).length > 0;
}

export async function deleteIndexFile(indexFile: string): Promise<void> {
  await rm(indexFile, { force: true });
  await rm(writeAheadLogOf(indexFile), { force: true });
}
