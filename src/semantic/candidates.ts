// Which files under a folder are worth indexing. Reuses the search tools' walk and default
// excludes (SRCH-7), and asks the PathPolicy about every file, so a protected file (PERM-4)
// never reaches an extractor.

import { stat } from "node:fs/promises";
import type { Config, PathPolicy } from "../contracts/index.ts";
import { ExcludeRules } from "../tools/search/excludes.ts";
import { relativeDisplay } from "../tools/search/format.ts";
import { mapWithConcurrency } from "../tools/search/paths.ts";
import { walk } from "../tools/search/walk.ts";
import { type IndexableKind, indexableKindOf } from "./extract/index.ts";

export interface CandidateFile {
  /** Absolute path, as the walk found it. */
  path: string;
  /** Relative to the root, with "/" separators: the key the index stores. */
  relativePath: string;
  kind: IndexableKind;
  sizeBytes: number;
  modifiedMs: number;
}

export interface CandidateScan {
  /** Sorted by relative path. */
  files: CandidateFile[];
  /** False when the walk hit its entry limit, so files it never saw may still exist. */
  walkComplete: boolean;
  /** Files left out, by reason, for the indexing summary. */
  leftOut: Map<string, number>;
}

export interface ScanOptions {
  root: string;
  config: Config;
  paths: PathPolicy;
  signal: AbortSignal;
}

export async function findCandidates(options: ScanOptions): Promise<CandidateScan> {
  const { root, config, signal } = options;
  const named: { path: string; kind: IndexableKind }[] = [];
  const summary = await walk({
    root,
    excludes: new ExcludeRules(root, { useDefaults: true, extra: [] }),
    signal,
    // The user started this and can cancel it; only the entry count bounds the walk.
    timeLimitMs: Number.POSITIVE_INFINITY,
    maxEntries: config.search.walkMaxEntries,
    onEntry: (entry) => {
      const kind = entry.isDirectory ? undefined : indexableKindOf(entry.name);
      if (kind) named.push({ path: entry.path, kind });
    },
  });

  const leftOut = new Map<string, number>();
  const checked = await mapWithConcurrency(named, (file) =>
    checkCandidate(file, options, (reason) => count(leftOut, reason)),
  );
  const files = checked
    .filter((file): file is CandidateFile => file !== undefined)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const limit = config.search.indexMaxFiles;
  if (files.length > limit) {
    count(leftOut, `over the ${limit.toLocaleString("en-US")}-file limit`, files.length - limit);
    files.length = limit;
  }
  return { files, walkComplete: summary.stoppedBy === undefined, leftOut };
}

async function checkCandidate(
  file: { path: string; kind: IndexableKind },
  options: ScanOptions,
  leaveOut: (reason: string) => void,
): Promise<CandidateFile | undefined> {
  const stats = await stat(file.path).catch(() => undefined);
  // A link to a folder, a socket, or a file that vanished since the walk listed it.
  if (!stats?.isFile() || stats.size === 0) return undefined;
  const settings = options.config.search;
  const sizeLimit =
    file.kind === "text" ? settings.indexMaxTextFileBytes : settings.indexMaxDocumentBytes;
  if (stats.size > sizeLimit) {
    leaveOut("too large");
    return undefined;
  }
  const { pathClass } = await options.paths.classify(file.path);
  if (pathClass === "denied") {
    leaveOut("protected");
    return undefined;
  }
  return {
    path: file.path,
    relativePath: relativeDisplay(options.root, file.path),
    kind: file.kind,
    sizeBytes: stats.size,
    modifiedMs: Math.floor(stats.mtimeMs),
  };
}

function count(counts: Map<string, number>, reason: string, amount = 1): void {
  counts.set(reason, (counts.get(reason) ?? 0) + amount);
}
