// A VixPaths rooted in a fresh temporary directory, with every directory created.
// Built through storage's own layout function, so the two cannot drift.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VixPaths } from "../contracts/index.ts";
import { buildVixPaths, ensurePrivateDirectories, sessionDirectories } from "../storage/index.ts";

export interface TemporaryVixPaths {
  paths: VixPaths;
  cleanup(): Promise<void>;
}

export async function createTemporaryVixPaths(
  sessionId = "test-session",
): Promise<TemporaryVixPaths> {
  const root = await mkdtemp(join(tmpdir(), "vix-test-"));
  const paths = buildVixPaths(root, sessionId);
  await ensurePrivateDirectories([
    paths.logsDirectory,
    paths.sessionsDirectory,
    ...sessionDirectories(paths.session),
  ]);
  return { paths, cleanup: () => rm(root, { recursive: true, force: true }) };
}
