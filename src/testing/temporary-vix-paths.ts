// A VixPaths rooted in a fresh temporary directory, with every directory created.
// Mirrors the layout in specs/storage.md. Once storage exists, this should build
// its paths through storage's own layout function so the two cannot drift.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VixPaths } from "../contracts/index.ts";

export interface TemporaryVixPaths {
  paths: VixPaths;
  cleanup(): Promise<void>;
}

export async function createTemporaryVixPaths(
  sessionId = "test-session",
): Promise<TemporaryVixPaths> {
  const root = await mkdtemp(join(tmpdir(), "vix-test-"));
  const sessionDirectory = join(root, "sessions", sessionId);
  const paths: VixPaths = {
    root,
    configFile: join(root, "config.json"),
    themeFile: join(root, "theme.json"),
    logsDirectory: join(root, "logs"),
    auditLog: join(root, "logs", "audit.jsonl"),
    sessionsDirectory: join(root, "sessions"),
    session: {
      id: sessionId,
      directory: sessionDirectory,
      transcript: join(sessionDirectory, "transcript.jsonl"),
      results: join(sessionDirectory, "results"),
      snapshots: join(sessionDirectory, "snapshots"),
      scratch: join(sessionDirectory, "tmp"),
    },
  };
  for (const directory of [
    paths.logsDirectory,
    paths.session.results,
    paths.session.snapshots,
    paths.session.scratch,
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return { paths, cleanup: () => rm(root, { recursive: true, force: true }) };
}
