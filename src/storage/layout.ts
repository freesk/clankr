// The one place that knows the layout of `~/.clankr/` (specs/storage.md, "Proposed layout").
// Every other part asks for a ClankrPaths built here instead of joining paths itself,
// which is what keeps `clankr wipe` and `--ephemeral` complete.

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ClankrPaths, SessionPaths } from "../contracts/index.ts";

/** Overrides the root, so tests and experiments never touch the real `~/.clankr/`. */
export const clankrHomeVariable = "CLANKR_HOME";

/** Settings files. `wipe` keeps these and deletes everything else. */
export const keptFileNames: readonly string[] = ["config.json", "theme.json"];

const configFileName = "config.json";
const themeFileName = "theme.json";
const logsDirectoryName = "logs";
const auditLogName = "audit.jsonl";
const sessionsDirectoryName = "sessions";
const ephemeralDirectoryName = "ephemeral";
const indexDirectoryName = "index";
const transcriptName = "transcript.jsonl";

/** Session ids appear in directory names and on the command line, so they stay this plain. */
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export type RootPaths = Omit<ClankrPaths, "session">;

/** `$CLANKR_HOME` when set, otherwise `~/.clankr`. */
export function resolveClankrRoot(
  environment: Record<string, string | undefined> = process.env,
  homeDirectory: string = homedir(),
): string {
  const override = environment[clankrHomeVariable];
  if (override) return resolve(expandHome(override, homeDirectory));
  return join(homeDirectory, ".clankr");
}

export function buildRootPaths(root: string): RootPaths {
  const logsDirectory = join(root, logsDirectoryName);
  return {
    root,
    configFile: join(root, configFileName),
    themeFile: join(root, themeFileName),
    logsDirectory,
    auditLog: join(logsDirectory, auditLogName),
    sessionsDirectory: join(root, sessionsDirectoryName),
    indexDirectory: join(root, indexDirectoryName),
  };
}

/** Paths for a saved session, under `sessions/<id>/`. */
export function buildClankrPaths(root: string, sessionId: string): ClankrPaths {
  assertValidSessionId(sessionId);
  const rootPaths = buildRootPaths(root);
  const directory = join(rootPaths.sessionsDirectory, sessionId);
  return { ...rootPaths, session: buildSessionPaths(sessionId, directory) };
}

/**
 * Paths for an ephemeral session, under `ephemeral/<pid>-<id>/`. The process id in the
 * name lets the startup sweep tell a crashed session from one that is still running.
 */
export function buildEphemeralClankrPaths(
  root: string,
  sessionId: string,
  processId: number,
): ClankrPaths {
  assertValidSessionId(sessionId);
  const directory = join(ephemeralDirectory(root), `${processId}-${sessionId}`);
  return { ...buildRootPaths(root), session: buildSessionPaths(sessionId, directory) };
}

export function ephemeralDirectory(root: string): string {
  return join(root, ephemeralDirectoryName);
}

/** The session's directories, parents first, in the order they must be created. */
export function sessionDirectories(session: SessionPaths): string[] {
  return [session.directory, session.results, session.snapshots, session.scratch];
}

/** Sortable by creation time, unique enough for one user's machine. */
export function newSessionId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function isValidSessionId(sessionId: string): boolean {
  return sessionIdPattern.test(sessionId);
}

function assertValidSessionId(sessionId: string): void {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid session id "${sessionId}": letters, digits, and dashes only.`);
  }
}

function buildSessionPaths(id: string, directory: string): SessionPaths {
  return {
    id,
    directory,
    transcript: join(directory, transcriptName),
    results: join(directory, "results"),
    snapshots: join(directory, "snapshots"),
    scratch: join(directory, "tmp"),
  };
}

function expandHome(path: string, homeDirectory: string): string {
  if (path === "~") return homeDirectory;
  if (path.startsWith("~/")) return join(homeDirectory, path.slice(2));
  return path;
}
