// Opening a session's storage: a new saved session, a resumed one, or an ephemeral one.
// The cli calls this once at startup and again for `/clear`, and closes it on exit.

import { readdir, rm } from "node:fs/promises";
import type { ClankrPaths, SessionTranscript } from "../contracts/index.ts";
import { createEphemeralSession, sweepEphemeralLeftovers } from "./ephemeral.ts";
import { buildClankrPaths, buildRootPaths, newSessionId, sessionDirectories } from "./layout.ts";
import { ensurePrivateDirectories, isMissingFileError } from "./private-files.ts";
import { DiscardingTranscript, FileTranscript } from "./transcript.ts";

export interface OpenSessionOptions {
  /** From `resolveClankrRoot()`. */
  root: string;
  /** `--ephemeral`: nothing is left on disk after exit. */
  ephemeral?: boolean;
  /**
   * The saved session to continue (`--resume`). Its directory is reused, so result
   * handles stored before the restart still resolve.
   */
  resumeSessionId?: string;
}

export interface StorageSession {
  paths: ClankrPaths;
  transcript: SessionTranscript;
  ephemeral: boolean;
  /** Ends the session's storage. Call on every exit; ephemeral sessions also clean up on their own. */
  close(): Promise<void>;
}

export async function openSession(options: OpenSessionOptions): Promise<StorageSession> {
  await sweepEphemeralLeftovers(options.root);
  if (options.ephemeral) {
    if (options.resumeSessionId) throw new Error("An ephemeral session cannot resume a saved one.");
    return openEphemeralSession(options.root);
  }
  return openSavedSession(options.root, options.resumeSessionId);
}

async function openEphemeralSession(root: string): Promise<StorageSession> {
  const session = await createEphemeralSession(root);
  return {
    paths: session.paths,
    transcript: new DiscardingTranscript(),
    ephemeral: true,
    close: async () => session.dispose(),
  };
}

async function openSavedSession(
  root: string,
  resumeSessionId: string | undefined,
): Promise<StorageSession> {
  const paths = buildClankrPaths(root, resumeSessionId ?? newSessionId());
  const rootPaths = buildRootPaths(root);
  await ensurePrivateDirectories([
    rootPaths.root,
    rootPaths.logsDirectory,
    rootPaths.sessionsDirectory,
    ...sessionDirectories(paths.session),
  ]);
  return {
    paths,
    transcript: new FileTranscript(paths.session.transcript, paths.session.id),
    ephemeral: false,
    close: () => removeIfUnused(paths),
  };
}

// Starting `clankr` and quitting without a word should not leave an empty session behind.
async function removeIfUnused(paths: ClankrPaths): Promise<void> {
  const subdirectories = sessionDirectories(paths.session).slice(1);
  for (const directory of [paths.session.directory, ...subdirectories]) {
    const expected = directory === paths.session.directory ? subdirectories.length : 0;
    if ((await countEntries(directory)) > expected) return;
  }
  await rm(paths.session.directory, { recursive: true, force: true });
}

async function countEntries(directory: string): Promise<number> {
  try {
    return (await readdir(directory)).length;
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
}
