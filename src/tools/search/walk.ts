// The directory walk: `find_files`'s fallback when Spotlight cannot answer (SRCH-2).
// Bounded by time and entry count, because a walk of a whole home folder can take
// minutes; when a bound stops it, the result says the search is incomplete.

import type { Dirent } from "node:fs";
import { opendir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ExcludeRules } from "./excludes.ts";

export interface WalkEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  /** Folders between the root and this entry: 0 for a direct child. */
  depth: number;
}

export interface WalkOptions {
  root: string;
  excludes: ExcludeRules;
  signal: AbortSignal;
  timeLimitMs: number;
  maxEntries: number;
  /** Called for every entry that is not excluded. */
  onEntry(entry: WalkEntry): void;
}

export interface WalkSummary {
  entriesSeen: number;
  /** Set when a bound stopped the walk before it finished. */
  stoppedBy?: "time" | "entries";
  /** Folders that could not be opened, usually for lack of permission. */
  unreadableFolders: number;
}

/** Folders read at once. Enough to hide disk latency without exhausting file handles. */
const parallelFolders = 16;

export async function walk(options: WalkOptions): Promise<WalkSummary> {
  const deadline = Date.now() + options.timeLimitMs;
  const summary: WalkSummary = { entriesSeen: 0, unreadableFolders: 0 };
  const pending: { path: string; depth: number }[] = [{ path: options.root, depth: 0 }];
  let active = 0;

  const shouldStop = (): boolean => {
    options.signal.throwIfAborted();
    if (summary.stoppedBy) return true;
    if (Date.now() > deadline) summary.stoppedBy = "time";
    else if (summary.entriesSeen >= options.maxEntries) summary.stoppedBy = "entries";
    return summary.stoppedBy !== undefined;
  };

  const readFolder = async (folder: { path: string; depth: number }): Promise<void> => {
    let directory: AsyncIterable<Dirent>;
    try {
      directory = await opendir(folder.path, { bufferSize: 256 });
    } catch {
      summary.unreadableFolders++;
      return;
    }
    for await (const dirent of directory) {
      if (shouldStop()) break;
      summary.entriesSeen++;
      const path = join(folder.path, dirent.name);
      if (options.excludes.isExcluded(relative(options.root, path))) continue;
      // Symbolic links are listed but never followed, so a link cannot loop the walk.
      const isDirectory = dirent.isDirectory();
      options.onEntry({ path, name: dirent.name, isDirectory, depth: folder.depth });
      if (isDirectory) pending.push({ path, depth: folder.depth + 1 });
    }
  };

  // A small pool of workers drains the queue; each new folder found joins the queue.
  await new Promise<void>((resolve, reject) => {
    const startMore = (): void => {
      while (active < parallelFolders && pending.length > 0 && !summary.stoppedBy) {
        const folder = pending.shift() as { path: string; depth: number };
        active++;
        readFolder(folder).then(
          () => {
            active--;
            startMore();
          },
          (error: unknown) => reject(error),
        );
      }
      if (active === 0 && (pending.length === 0 || summary.stoppedBy)) resolve();
    };
    startMore();
  });
  return summary;
}
