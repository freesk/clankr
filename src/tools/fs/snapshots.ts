// Snapshots for `/undo` (FS-9, D27). Before a change, a full copy of what it touches is
// saved under the session's snapshot folder, with a manifest of the steps that reverse it.
// Undo is single level, so committing a snapshot removes the one before it.

import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyEntry, createDirectories, pathExists } from "./disk.ts";

/** What an entry looked like right after the change, to detect later edits outside vix. */
export interface Fingerprint {
  kind: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedTimeMs: number;
}

/** One step that reverses part of a change. Steps are undone in reverse order. */
export type UndoStep =
  /** A file's contents were replaced; put the saved copy back. */
  | { kind: "restore-content"; path: string; backup: string; after: Fingerprint }
  /** A file or folder tree was created; move it to the Trash. */
  | { kind: "remove-created"; path: string; after: Fingerprint }
  /** An empty folder was created; remove it if it is still empty. */
  | { kind: "remove-created-directory"; path: string }
  /** An entry was moved from `from` to `to`; move it back. */
  | { kind: "move-back"; from: string; to: string; after: Fingerprint }
  /** An entry was moved to the Trash; put the saved copy back. */
  | { kind: "restore-deleted"; path: string; backup: string };

export interface SnapshotManifest {
  /** One line, for example "edit notes.md". */
  description: string;
  createdAt: string;
  steps: UndoStep[];
}

export interface Snapshot {
  directory: string;
  manifest: SnapshotManifest;
}

const manifestFileName = "manifest.json";

export function fingerprintOf(stats: Stats): Fingerprint {
  const kind = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other";
  return { kind, sizeBytes: stats.size, modifiedTimeMs: stats.mtimeMs };
}

/**
 * Whether an entry still looks as the change left it. A folder's own size and time change
 * whenever anything inside it changes, so folders are compared by kind only.
 */
export function sameFingerprint(expected: Fingerprint, actual: Fingerprint): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "directory") return true;
  return (
    expected.sizeBytes === actual.sizeBytes && expected.modifiedTimeMs === actual.modifiedTimeMs
  );
}

export class SnapshotStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  /** Starts recording a change. Call `finish` on the recorder whether or not the change worked. */
  async begin(description: string): Promise<ChangeRecorder> {
    // A sortable name, so the newest snapshot is the last one listed.
    const name = `${Date.now().toString().padStart(15, "0")}-${randomBytes(3).toString("hex")}`;
    const snapshotDirectory = join(this.directory, name);
    await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
    return new ChangeRecorder(this, snapshotDirectory, description);
  }

  /** The snapshot `/undo` would reverse, if there is one. */
  async latest(): Promise<Snapshot | undefined> {
    for (const name of (await this.snapshotNames()).reverse()) {
      const directory = join(this.directory, name);
      const manifestPath = join(directory, manifestFileName);
      if (!(await pathExists(manifestPath))) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SnapshotManifest;
      return { directory, manifest };
    }
    return undefined;
  }

  /** Removes every snapshot except `keep`. Snapshots are vix's own files, never the user's. */
  async removeAllExcept(keep?: string): Promise<void> {
    for (const name of await this.snapshotNames()) {
      const directory = join(this.directory, name);
      if (directory !== keep) await rm(directory, { recursive: true, force: true });
    }
  }

  private async snapshotNames(): Promise<string[]> {
    if (!(await pathExists(this.directory))) return [];
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }
}

/** Collects the undo steps of one change as it happens. */
export class ChangeRecorder {
  private readonly steps: UndoStep[] = [];
  private backupCount = 0;

  private readonly store: SnapshotStore;
  private readonly directory: string;
  private readonly description: string;

  constructor(store: SnapshotStore, directory: string, description: string) {
    this.store = store;
    this.directory = directory;
    this.description = description;
  }

  /** Saves a full copy of a file or folder tree and returns where the copy is. */
  async backup(path: string): Promise<string> {
    this.backupCount += 1;
    const backupPath = join(this.directory, "backup", String(this.backupCount));
    await mkdir(join(this.directory, "backup"), { recursive: true });
    await copyEntry(path, backupPath);
    return backupPath;
  }

  /** Creates a folder and its missing parents, recording each so undo can remove them. */
  async createDirectories(directory: string): Promise<void> {
    for (const folder of await createDirectories(directory)) {
      this.record({ kind: "remove-created-directory", path: folder });
    }
  }

  record(step: UndoStep): void {
    this.steps.push(step);
  }

  /**
   * Commits whatever steps were recorded, so even a change that failed halfway can be
   * undone, and drops the previous snapshot. Records nothing if nothing changed.
   */
  async finish(): Promise<void> {
    if (this.steps.length === 0) {
      await rm(this.directory, { recursive: true, force: true });
      return;
    }
    const manifest: SnapshotManifest = {
      description: this.description,
      createdAt: new Date().toISOString(),
      steps: this.steps,
    };
    await writeFile(join(this.directory, manifestFileName), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await this.store.removeAllExcept(this.directory);
  }
}
