// Read-before-overwrite (FS-1): `write_file` may only replace a file the model has read in
// this session and that has not changed since. `read_file` fills the tracker.

import type { Stats } from "node:fs";
import { type FileReadState, type ReadTracker, ToolError } from "../../contracts/index.ts";

export function readStateOf(stats: Stats): FileReadState {
  return { modifiedTimeMs: stats.mtimeMs, sizeBytes: stats.size };
}

function sameReadState(first: FileReadState, second: FileReadState): boolean {
  return first.modifiedTimeMs === second.modifiedTimeMs && first.sizeBytes === second.sizeBytes;
}

export function requireUnchangedSinceRead(
  tracker: ReadTracker,
  realPath: string,
  current: Stats,
  displayName: string,
): void {
  const recorded = tracker.readState(realPath);
  if (!recorded) {
    throw new ToolError(
      `${displayName} already exists and has not been read. Call read_file on it first, ` +
        "or use edit_file to change part of it.",
    );
  }
  if (!sameReadState(recorded, readStateOf(current))) {
    throw new ToolError(
      `${displayName} changed on disk since it was read. Call read_file again before overwriting it.`,
    );
  }
}

/**
 * After clankr itself changes a file the model had read, the model still knows its contents,
 * so the recorded state moves forward. A file that was stale before stays stale.
 */
export function carryReadStateForward(
  tracker: ReadTracker,
  realPath: string,
  before: Stats,
  after: Stats,
): void {
  const recorded = tracker.readState(realPath);
  if (recorded && sameReadState(recorded, readStateOf(before))) {
    tracker.markRead(realPath, readStateOf(after));
  }
}
