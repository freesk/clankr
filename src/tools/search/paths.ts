// Every path a search tool touches goes through the PathPolicy. Read tools may look
// outside the allowed roots without asking (they never prompt), but a denied path is
// refused as a root and silently dropped from results.

import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { type PathPolicy, type ToolContext, ToolError } from "../../contracts/index.ts";

export interface ResolvedPath {
  realPath: string;
  stats: Stats;
}

/** Classifies a path the model gave, refusing it if it is denied or does not exist. */
export async function resolveExistingPath(
  path: string,
  context: ToolContext,
): Promise<ResolvedPath> {
  const { realPath, pathClass } = await context.paths.classify(path);
  if (pathClass === "denied") {
    throw new ToolError(`${path} is protected and cannot be read. Choose another path.`);
  }
  try {
    return { realPath, stats: await stat(realPath) };
  } catch {
    throw new ToolError(`${path} does not exist. Check the path with list_dir or find_files.`);
  }
}

/** Like resolveExistingPath, but the path must be a folder. */
export async function resolveFolder(path: string, context: ToolContext): Promise<string> {
  const resolved = await resolveExistingPath(path, context);
  if (!resolved.stats.isDirectory()) {
    throw new ToolError(`${path} is a file, not a folder. Pass the folder that contains it.`);
  }
  return resolved.realPath;
}

/** Drops every path the policy denies, keeping the order of the rest. */
export async function dropDeniedPaths<Item extends { path: string }>(
  items: Item[],
  policy: PathPolicy,
): Promise<Item[]> {
  const verdicts = await mapWithConcurrency(items, async (item) => {
    const { pathClass } = await policy.classify(item.path);
    return pathClass !== "denied";
  });
  return items.filter((_, index) => verdicts[index]);
}

const defaultConcurrency = 64;

/** Runs `work` over every item with a bounded number in flight, keeping input order. */
export async function mapWithConcurrency<Item, Result>(
  items: Item[],
  work: (item: Item) => Promise<Result>,
  concurrency = defaultConcurrency,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await work(items[index] as Item);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
