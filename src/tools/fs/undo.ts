// `/undo` (FS-9, D27): reverse the most recent file change from its snapshot. Single level:
// after an undo, or with no change yet, there is nothing more to undo.

import { mkdir, readFile, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SlashCommand } from "../../contracts/index.ts";
import { copyEntry, isErrorCode, isOccupiedByAnother, moveEntry, statIfPresent } from "./disk.ts";
import {
  type Fingerprint,
  fingerprintOf,
  SnapshotStore,
  sameFingerprint,
  type UndoStep,
} from "./snapshots.ts";
import { writeFileAtomically } from "./text-file.ts";
import type { FileToolDependencies } from "./trash.ts";

export interface UndoDependencies extends FileToolDependencies {
  /** The session's snapshot folder, `VixPaths.session.snapshots`. */
  snapshotsDirectory: string;
}

export function createUndoCommand(dependencies: UndoDependencies): SlashCommand {
  return {
    name: "undo",
    summary: "Undo the last file change made in this session",
    usage: "/undo",
    async run(_argumentText, context) {
      context.print(await undoLastChange(dependencies));
    },
  };
}

/** Reverses the newest snapshot and returns a message for the user. */
export async function undoLastChange(dependencies: UndoDependencies): Promise<string> {
  const store = new SnapshotStore(dependencies.snapshotsDirectory);
  const snapshot = await store.latest();
  if (!snapshot) return "Nothing to undo.";

  const { description, steps } = snapshot.manifest;
  const reversed = [...steps].reverse();
  const problems: string[] = [];
  for (const step of reversed) {
    const problem = await findConflict(step);
    if (problem) problems.push(problem);
  }
  if (problems.length > 0) {
    return `Cannot undo "${description}": ${problems.join(" ")} Nothing was changed.`;
  }

  const notes: string[] = [];
  for (const step of reversed) {
    const note = await reverseStep(step, dependencies);
    if (note) notes.push(note);
  }
  await store.removeAllExcept();
  return [`Undid "${description}".`, ...notes].join(" ");
}

/** Why a step cannot be reversed safely: something changed it outside vix since. */
async function findConflict(step: UndoStep): Promise<string | undefined> {
  switch (step.kind) {
    case "restore-content":
    case "remove-created":
      return (await matchesFingerprint(step.path, step.after))
        ? undefined
        : `${step.path} changed after the change was made.`;
    case "move-back":
      if (!(await matchesFingerprint(step.to, step.after))) {
        return `${step.to} changed or moved after the change was made.`;
      }
      return (await isOccupiedByAnother(step.from, step.to))
        ? `${step.from} exists again, so ${step.to} cannot be moved back.`
        : undefined;
    case "restore-deleted":
      return (await statIfPresent(step.path))
        ? `${step.path} exists again, so the deleted copy cannot be restored.`
        : undefined;
    case "remove-created-directory":
      // Checked when it is reached: steps undone before it may be what empties it.
      return undefined;
  }
}

async function matchesFingerprint(path: string, expected: Fingerprint): Promise<boolean> {
  const current = await statIfPresent(path);
  return current !== undefined && sameFingerprint(expected, fingerprintOf(current));
}

async function reverseStep(
  step: UndoStep,
  dependencies: FileToolDependencies,
): Promise<string | undefined> {
  switch (step.kind) {
    case "restore-content": {
      const current = await statIfPresent(step.path);
      await writeFileAtomically(
        step.path,
        await readFile(step.backup),
        current ? current.mode & 0o7777 : undefined,
      );
      return undefined;
    }
    case "remove-created":
      // A file vix created goes to the Trash rather than being unlinked, in case it matters.
      await dependencies.trash([step.path]);
      return undefined;
    case "remove-created-directory":
      return removeFolderIfEmpty(step.path);
    case "move-back":
      await mkdir(dirname(step.from), { recursive: true });
      await moveEntry(step.to, step.from, dependencies.trash);
      return undefined;
    case "restore-deleted":
      await mkdir(dirname(step.path), { recursive: true });
      await copyEntry(step.backup, step.path);
      return undefined;
  }
}

async function removeFolderIfEmpty(path: string): Promise<string | undefined> {
  try {
    await rmdir(path);
    return undefined;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    if (isErrorCode(error, "ENOTEMPTY")) return `Kept ${path} because it is no longer empty.`;
    throw error;
  }
}
