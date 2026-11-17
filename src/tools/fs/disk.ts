// Small disk operations shared by the file tools and `/undo`.

import type { Stats } from "node:fs";
import { cp, lstat, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { TrashFunction } from "./trash.ts";

/** `lstat`, or undefined when nothing is there. Other errors still throw. */
export async function statIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** `stat`, which follows symbolic links, or undefined when nothing is there. */
export async function statFollowingLinks(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return (await statIfPresent(path)) !== undefined;
}

/**
 * True when something other than `self` is at `path`. On a case-insensitive volume,
 * "notes.md" and "Notes.md" can name the same entry, which does not count.
 */
export async function isOccupiedByAnother(path: string, self: string): Promise<boolean> {
  const atPath = await statIfPresent(path);
  if (!atPath) return false;
  const selfStats = await statIfPresent(self);
  return !(selfStats && selfStats.ino === atPath.ino && selfStats.dev === atPath.dev);
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/** The folders that `mkdir -p` would create for this folder, outermost first. */
export async function missingDirectories(directory: string): Promise<string[]> {
  const missing: string[] = [];
  let current = directory;
  while (!(await pathExists(current))) {
    missing.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}

/** Creates the folder and any missing parents. Returns the folders it created, outermost first. */
export async function createDirectories(directory: string): Promise<string[]> {
  const created = await missingDirectories(directory);
  if (created.length > 0) await mkdir(directory, { recursive: true });
  return created;
}

/** Copies a file or a whole folder tree, keeping symbolic links as links. Never overwrites. */
export async function copyEntry(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

/**
 * Renames, or across volumes copies and then trashes the original, so nothing in this
 * part ever unlinks a user file.
 */
export async function moveEntry(source: string, target: string, trash: TrashFunction) {
  try {
    await rename(source, target);
  } catch (error) {
    if (!isErrorCode(error, "EXDEV")) throw error;
    await copyEntry(source, target);
    await trash([source]);
  }
}
