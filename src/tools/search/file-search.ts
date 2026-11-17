// Chooses how `find_files` searches: Spotlight where the index covers the root, a
// bounded directory walk where it does not. Both paths end in the same filter, so the
// choice changes speed and completeness, never which files match.

import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, relative } from "node:path";
import type { ExcludeRules } from "./excludes.ts";
import { type FileCriteria, matchesCriteria, matchesNameAndKind } from "./file-criteria.ts";
import { countLabel } from "./format.ts";
import { mapWithConcurrency } from "./paths.ts";
import type { SpotlightIndex } from "./spotlight.ts";
import { buildSpotlightQuery } from "./spotlight-query.ts";
import { walk } from "./walk.ts";

export interface FoundEntry {
  path: string;
  name: string;
  stats: Stats;
}

export interface FileSearchResult {
  entries: FoundEntry[];
  method: "Spotlight" | "folder walk";
  /** Lines for the model: why a fallback was used, or why results may be incomplete. */
  notes: string[];
}

export interface FileSearchRequest {
  root: string;
  criteria: FileCriteria;
  excludes: ExcludeRules;
  signal: AbortSignal;
  spotlight: SpotlightIndex;
  limits: { spotlightMaxResults: number; walkTimeLimitMs: number; walkMaxEntries: number };
}

export async function searchFiles(request: FileSearchRequest): Promise<FileSearchResult> {
  const coverage = await request.spotlight.coverage(request.root, request.signal);
  if (coverage.covered) {
    try {
      return await searchWithSpotlight(request);
    } catch (error) {
      if (request.signal.aborted) throw error;
      return withNote(await searchByWalking(request), "Spotlight query failed");
    }
  }
  return withNote(await searchByWalking(request), coverage.reason);
}

function withNote(result: FileSearchResult, reason: string): FileSearchResult {
  const note = `Note: ${reason}, so this searched by walking the folder, which is slower.`;
  return { ...result, notes: [note, ...result.notes] };
}

async function searchWithSpotlight(request: FileSearchRequest): Promise<FileSearchResult> {
  const query = buildSpotlightQuery(request.criteria);
  const { paths, truncated } = await request.spotlight.query(request.root, query, {
    signal: request.signal,
    maxResults: request.limits.spotlightMaxResults,
  });
  const candidates = paths.filter((path) => {
    const inside = relative(request.root, path);
    // Spotlight can list the root itself, which a walk never does.
    return inside !== "" && !request.excludes.isExcluded(inside);
  });
  const entries = await statMatching(candidates, request.criteria);
  const notes = truncated
    ? [
        `Note: Spotlight matched more than ${countLabel(request.limits.spotlightMaxResults, "file")}; only those were ranked. Narrow the search for a complete answer.`,
      ]
    : [];
  return { entries, method: "Spotlight", notes };
}

async function searchByWalking(request: FileSearchRequest): Promise<FileSearchResult> {
  const candidates: string[] = [];
  const summary = await walk({
    root: request.root,
    excludes: request.excludes,
    signal: request.signal,
    timeLimitMs: request.limits.walkTimeLimitMs,
    maxEntries: request.limits.walkMaxEntries,
    onEntry(entry) {
      // Name and type are checked here, before any stat, because most entries fail them.
      if (matchesNameAndKind(entry.name, entry.isDirectory, request.criteria)) {
        candidates.push(entry.path);
      }
    },
  });
  const entries = await statMatching(candidates, request.criteria);
  const notes: string[] = [];
  if (summary.stoppedBy === "time") {
    notes.push(
      `Note: the walk stopped after ${request.limits.walkTimeLimitMs / 1000} s, so results are incomplete. Pass a narrower root.`,
    );
  } else if (summary.stoppedBy === "entries") {
    notes.push(
      `Note: the walk stopped after ${countLabel(summary.entriesSeen, "entry", "entries")}, so results are incomplete. Pass a narrower root.`,
    );
  }
  if (summary.unreadableFolders > 0) {
    notes.push(`Note: ${countLabel(summary.unreadableFolders, "folder")} could not be opened.`);
  }
  return { entries, method: "folder walk", notes };
}

/** Stats each candidate and keeps those that pass every filter. Vanished files are skipped. */
async function statMatching(paths: string[], criteria: FileCriteria): Promise<FoundEntry[]> {
  const found = await mapWithConcurrency(paths, async (path) => {
    try {
      const stats = await stat(path);
      const name = basename(path);
      return matchesCriteria(name, stats, criteria) ? { path, name, stats } : undefined;
    } catch {
      return undefined;
    }
  });
  return found.filter((entry): entry is FoundEntry => entry !== undefined);
}
