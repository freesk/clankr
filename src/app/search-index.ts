// `clankr index` and `/index` with the real parts: the LM Studio connection that embeds the
// passages, the path policy with the deny list, and the index directory under the clankr
// root. The cli loads this module lazily, like the harness.

import type { Config, IndexOutcome, IndexRequest, IndexRunOptions } from "../contracts/index.ts";
import { runIndexRequest } from "../semantic/index.ts";
import { buildRootPaths } from "../storage/index.ts";
import type { CreateLmConnection } from "./lm-connection.ts";
import { createPathPolicy } from "./path-policy.ts";

export interface SearchIndexSeams {
  /** From storage's `resolveClankrRoot`. */
  root: string;
  createConnection: CreateLmConnection;
  /** Replaces the home folder for the path policy, in tests. */
  homeDirectory?: string;
}

export interface SearchIndexOptions extends IndexRunOptions {
  config: Config;
  workingDirectory: string;
}

export async function runSearchIndexRequest(
  request: IndexRequest,
  options: SearchIndexOptions,
  seams: SearchIndexSeams,
): Promise<IndexOutcome> {
  const { config } = options;
  // Building the client opens no connection; only an indexing run talks to LM Studio.
  const connection = await seams.createConnection(config, options.print);
  try {
    return await runIndexRequest(request, {
      config,
      lm: connection.lm,
      paths: createPathPolicy(config, {
        clankrRoot: seams.root,
        workingDirectory: options.workingDirectory,
        ...(seams.homeDirectory ? { homeDirectory: seams.homeDirectory } : {}),
      }),
      indexDirectory: buildRootPaths(seams.root).indexDirectory,
      signal: options.signal,
      print: options.print,
      showProgress: options.showProgress,
    });
  } finally {
    await connection.dispose();
  }
}
