// Ephemeral sessions (CLI-7): a private directory for large results and scratch files
// that is removed on every exit path, plus a startup sweep for what a crash left behind.

import { existsSync, rmdirSync, rmSync } from "node:fs";
import { readdir, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { ClankrPaths } from "../contracts/index.ts";
import {
  buildEphemeralClankrPaths,
  ephemeralDirectory,
  newSessionId,
  sessionDirectories,
} from "./layout.ts";
import { ensurePrivateDirectories, isMissingFileError } from "./private-files.ts";

/** Signals that end the process by default. SIGKILL cannot be caught; the sweep covers it. */
const handledSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export interface EphemeralSession {
  paths: ClankrPaths;
  /** Removes the directory now and stops listening for exit. Safe to call twice. */
  dispose(): void;
}

export async function createEphemeralSession(root: string): Promise<EphemeralSession> {
  const paths = buildEphemeralClankrPaths(root, newSessionId(), process.pid);
  // Parents that did not exist before are removed again on exit, so the tree under
  // the root ends up exactly as it was.
  const createdParents = [root, ephemeralDirectory(root)].filter((path) => !existsSync(path));
  await ensurePrivateDirectories([...createdParents, ...sessionDirectories(paths.session)]);

  let removed = false;
  const removeEverything = (): void => {
    if (removed) return;
    removed = true;
    rmSync(paths.session.directory, { recursive: true, force: true });
    for (const parent of [...createdParents].reverse()) removeIfEmptySync(parent);
  };
  const stopListening = listenForExit(removeEverything);

  return {
    paths,
    dispose(): void {
      stopListening();
      removeEverything();
    },
  };
}

/**
 * Removes ephemeral directories whose process is gone. Run at every startup.
 * A directory belonging to a running `clankr` is left alone. Returns what was removed.
 */
export async function sweepEphemeralLeftovers(root: string): Promise<string[]> {
  const parent = ephemeralDirectory(root);
  let names: string[];
  try {
    names = await readdir(parent);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const removed: string[] = [];
  for (const name of names) {
    const owner = ownerProcessId(name);
    if (owner !== undefined && isProcessAlive(owner)) continue;
    const path = join(parent, name);
    await rm(path, { recursive: true, force: true });
    removed.push(path);
  }
  await removeIfEmpty(parent);
  return removed;
}

// Exit hooks must be synchronous: nothing asynchronous runs after "exit" fires.
function listenForExit(removeEverything: () => void): () => void {
  const onSignal = (signal: NodeJS.Signals): void => {
    // Another listener (the cli cancelling a turn on Ctrl-C) owns this signal and decides
    // whether the process ends; if it does, the "exit" hook still cleans up.
    if (process.listenerCount(signal) > 1) return;
    stopListening();
    removeEverything();
    // Re-raise with the default handler so the exit status still says "killed by signal".
    process.kill(process.pid, signal);
  };
  const stopListening = (): void => {
    process.removeListener("exit", removeEverything);
    for (const signal of handledSignals) process.removeListener(signal, onSignal);
  };
  process.once("exit", removeEverything);
  for (const signal of handledSignals) process.on(signal, onSignal);
  return stopListening;
}

function ownerProcessId(directoryName: string): number | undefined {
  const match = /^(\d+)-/.exec(directoryName);
  return match?.[1] ? Number(match[1]) : undefined;
}

function isProcessAlive(processId: number): boolean {
  if (processId === process.pid) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function removeIfEmptySync(path: string): void {
  try {
    rmdirSync(path);
  } catch {
    // Not empty (another session uses it) or already gone: either way, leave it.
  }
}

async function removeIfEmpty(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch {
    // Not empty or already gone.
  }
}
