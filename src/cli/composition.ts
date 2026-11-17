// Wires the other parts into the one dependency object the cli uses. The real harness lives
// in src/app/ and is imported only when a session opens, so `--help`, `--version`, and
// `wipe` stay fast (startup rule, PRD section 9).

import type { LmConnection } from "../app/lm-connection.ts";
import { loadConfig } from "../config/index.ts";
import type { Config, WipeReport } from "../contracts/index.ts";
import { buildRootPaths, resolveVixRoot, wipe } from "../storage/index.ts";
import type { FileToolDependencies } from "../tools/fs/index.ts";
import type { CliComposition, Harness, HarnessOptions } from "./harness.ts";

/** What tests replace. Every field defaults to the real thing. */
export interface CompositionOverrides {
  /** Read for `VIX_HOME`; defaults to the process environment. */
  environment?: Record<string, string | undefined>;
  /** The home folder for `~` and the deny list. */
  homeDirectory?: string;
  /** Builds the model connection; defaults to the real LM Studio client. */
  createLmConnection?: (config: Config, notify: (text: string) => void) => Promise<LmConnection>;
  /** The Trash used by `delete` and `/undo`; tests pass a private one (D54). */
  fileTools?: FileToolDependencies;
}

export function createComposition(overrides: CompositionOverrides = {}): CliComposition {
  const root = () => resolveVixRoot(overrides.environment ?? process.env, overrides.homeDirectory);
  return {
    loadConfig: ({ flags, workingDirectory, environment }) =>
      loadConfig({
        configFilePath: buildRootPaths(root()).configFile,
        workingDirectory,
        environment,
        flags,
      }),
    openHarness: (options) => openRealHarness(options, root(), overrides),
    wipe: () => wipeEverything(root()),
  };
}

async function openRealHarness(
  options: HarnessOptions,
  root: string,
  overrides: CompositionOverrides,
): Promise<Harness> {
  const [{ openHarness }, { createLmStudioConnection }, { moveToSystemTrash }] = await Promise.all([
    import("../app/open-harness.ts"),
    import("../app/lm-connection.ts"),
    import("../tools/fs/index.ts"),
  ]);
  const notify = options.notify ?? (() => {});
  const createConnection = overrides.createLmConnection ?? createLmStudioConnection;
  return openHarness(options, {
    root,
    connection: await createConnection(options.config, notify),
    fileTools: overrides.fileTools ?? { trash: moveToSystemTrash },
    ...(overrides.homeDirectory ? { homeDirectory: overrides.homeDirectory } : {}),
  });
}

// The cli has already asked for confirmation (D32), so storage is told yes.
async function wipeEverything(root: string): Promise<WipeReport> {
  const { plan } = await wipe(root, { yes: true });
  return { sessionsRemoved: plan.sessionCount, bytesFreed: plan.sizeBytes };
}
