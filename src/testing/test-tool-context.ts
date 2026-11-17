// Builds a ToolContext from fakes, so a tool test only states what it cares about.

import { defaultConfig } from "../config/index.ts";
import type { ToolContext } from "../contracts/index.ts";
import { InMemoryResultStore } from "./in-memory-result-store.ts";
import { ScriptedLmClient } from "./scripted-lm-client.ts";
import {
  FixedPathPolicy,
  InMemoryDataSourceRegistry,
  InMemoryReadTracker,
} from "./simple-fakes.ts";
import { createTemporaryVixPaths } from "./temporary-vix-paths.ts";

export interface TestToolContext {
  context: ToolContext;
  cleanup(): Promise<void>;
}

/** The working directory defaults to the temporary root, which is also the only allowed root. */
export async function createTestToolContext(
  overrides: Partial<ToolContext> = {},
): Promise<TestToolContext> {
  const temporary = await createTemporaryVixPaths();
  const workingDirectory = overrides.workingDirectory ?? temporary.paths.root;
  const config = defaultConfig();
  config.permissions.allowedRoots = [workingDirectory];

  const context: ToolContext = {
    signal: new AbortController().signal,
    results: new InMemoryResultStore(),
    paths: new FixedPathPolicy({ allowedRoots: [workingDirectory] }),
    dataSources: new InMemoryDataSourceRegistry(),
    readTracker: new InMemoryReadTracker(),
    lm: new ScriptedLmClient(),
    vixPaths: temporary.paths,
    config,
    workingDirectory,
    ...overrides,
  };
  return { context, cleanup: temporary.cleanup };
}
