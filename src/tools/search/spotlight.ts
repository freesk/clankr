// The Spotlight backend of `find_files` (SRCH-2): runs `mdfind` and decides whether
// the index can be trusted for a given root. When it cannot, `find_files` walks the
// folder instead and says so (the Spotlight risk row in PRD section 12).

import { readdir } from "node:fs/promises";
import { sep } from "node:path";
import { runForOutput, runProcess } from "./run-process.ts";

export type Coverage = { covered: true } | { covered: false; reason: string };

export interface SpotlightQueryResult {
  paths: string[];
  /** True when more paths matched than `maxResults`. */
  truncated: boolean;
}

/** What `find_files` needs from Spotlight. Tests replace it with a fake. */
export interface SpotlightIndex {
  coverage(root: string, signal: AbortSignal): Promise<Coverage>;
  query(
    root: string,
    query: string,
    options: { signal: AbortSignal; maxResults: number },
  ): Promise<SpotlightQueryResult>;
}

const mdfindBinary = "/usr/bin/mdfind";
const mdutilBinary = "/usr/bin/mdutil";
const probeChildCount = 3;

export const macSpotlight: SpotlightIndex = {
  async coverage(root, signal) {
    if (hasHiddenSegment(root)) {
      return { covered: false, reason: "Spotlight does not index hidden folders" };
    }
    if (!(await isVolumeIndexed(volumeOf(root), signal))) {
      return { covered: false, reason: "Spotlight indexing is off for this volume" };
    }
    // A volume's own root is covered whenever the volume is indexed; the probe is for folders.
    const isVolumeRoot = root === volumeOf(root);
    if (!isVolumeRoot && !(await indexKnowsChildrenOf(root, signal))) {
      return { covered: false, reason: "Spotlight has not indexed this folder" };
    }
    return { covered: true };
  },

  async query(root, query, { signal, maxResults }) {
    const paths: string[] = [];
    const run = await runProcess(mdfindBinary, [...scopeArguments(root), query], {
      signal,
      onRecord(path) {
        paths.push(path);
        return paths.length < maxResults;
      },
    });
    if (!run.stopped && run.exitCode !== 0) {
      throw new Error(`mdfind failed (${run.exitCode}): ${run.stderr.trim()}`);
    }
    return { paths, truncated: run.stopped };
  },
};

/**
 * `-onlyin /` is measured at about 2 s where the same query with no scope takes 0.2 s,
 * so the whole machine is searched with no scope at all. Every path is under "/" anyway.
 */
function scopeArguments(root: string): string[] {
  return root === "/" ? [] : ["-onlyin", root];
}

function hasHiddenSegment(path: string): boolean {
  return path.split(sep).some((segment) => segment.startsWith("."));
}

/** Other disks are mounted under /Volumes; everything else lives on the boot volume. */
function volumeOf(path: string): string {
  const match = /^\/Volumes\/[^/]+/.exec(path);
  return match ? match[0] : "/";
}

async function isVolumeIndexed(volume: string, signal: AbortSignal): Promise<boolean> {
  try {
    const { stdout } = await runForOutput(mdutilBinary, ["-s", volume], signal);
    return /Indexing enabled/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * A volume can be indexed while a folder on it is not (Spotlight privacy exclusions,
 * folders Spotlight skips). Asking for a few of the root's own children by name is a
 * cheap, direct test: if Spotlight knows none of them, it does not cover this root.
 */
async function indexKnowsChildrenOf(root: string, signal: AbortSignal): Promise<boolean> {
  const children = await visibleChildNames(root);
  if (children.length === 0) return false;
  const counts = await Promise.all(
    children.map(async (name) => {
      const query = `kMDItemFSName == '${name.replace(/[\\'"*]/g, "\\$&")}'`;
      const { stdout } = await runForOutput(
        mdfindBinary,
        ["-onlyin", root, "-count", query],
        signal,
      );
      return Number.parseInt(stdout.trim(), 10) || 0;
    }),
  );
  return counts.some((count) => count > 0);
}

async function visibleChildNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root);
    return entries.filter((name) => !name.startsWith(".")).slice(0, probeChildCount);
  } catch {
    return [];
  }
}
