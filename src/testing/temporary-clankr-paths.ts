// A ClankrPaths rooted in a fresh temporary directory, with every directory created.
// Built through storage's own layout function, so the two cannot drift.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClankrPaths } from "../contracts/index.ts";
import {
  buildClankrPaths,
  ensurePrivateDirectories,
  sessionDirectories,
} from "../storage/index.ts";

export interface TemporaryClankrPaths {
  paths: ClankrPaths;
  cleanup(): Promise<void>;
}

export async function createTemporaryClankrPaths(
  sessionId = "test-session",
): Promise<TemporaryClankrPaths> {
  const root = await mkdtemp(join(tmpdir(), "clankr-test-"));
  const paths = buildClankrPaths(root, sessionId);
  await ensurePrivateDirectories([
    paths.logsDirectory,
    paths.sessionsDirectory,
    ...sessionDirectories(paths.session),
  ]);
  return { paths, cleanup: () => rm(root, { recursive: true, force: true }) };
}
