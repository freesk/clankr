// `clankr wipe` (CLI-6, SEC-6): permanently deletes sessions, stored results, snapshots,
// scratch files, and logs. Keeps the settings files. Never moves anything to the Trash,
// since a Trash full of transcripts would defeat the purpose.

import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildRootPaths, ephemeralDirectory, keptFileNames } from "./layout.ts";
import { isMissingFileError } from "./private-files.ts";

export interface WipePlan {
  root: string;
  /** Saved sessions plus leftover ephemeral ones. */
  sessionCount: number;
  sizeBytes: number;
  /** Top-level entries under the root that will be deleted. */
  entries: string[];
}

/** `{ yes: true }` is `clankr wipe --yes`; otherwise the cli shows the plan and asks. */
export type WipeConfirmation = { yes: true } | { confirm(plan: WipePlan): Promise<boolean> };

export type WipeOutcome = "deleted" | "declined" | "nothing-to-delete";

export async function planWipe(root: string): Promise<WipePlan> {
  const entries = (await readdirOrEmpty(root))
    .filter((name) => !keptFileNames.includes(name))
    .map((name) => join(root, name));
  let sizeBytes = 0;
  for (const entry of entries) sizeBytes += await sizeOnDisk(entry);
  const sessionCount =
    (await readdirOrEmpty(buildRootPaths(root).sessionsDirectory)).length +
    (await readdirOrEmpty(ephemeralDirectory(root))).length;
  return { root, sessionCount, sizeBytes, entries };
}

export async function wipe(
  root: string,
  confirmation: WipeConfirmation,
): Promise<{ outcome: WipeOutcome; plan: WipePlan }> {
  const plan = await planWipe(root);
  if (plan.entries.length === 0) return { outcome: "nothing-to-delete", plan };
  const approved = "yes" in confirmation || (await confirmation.confirm(plan));
  if (!approved) return { outcome: "declined", plan };
  for (const entry of plan.entries) await rm(entry, { recursive: true, force: true });
  return { outcome: "deleted", plan };
}

async function sizeOnDisk(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdirOrEmpty(path)) total += await sizeOnDisk(join(path, name));
  return total;
}

async function readdirOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}
