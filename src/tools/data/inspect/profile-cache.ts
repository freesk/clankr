// Profiles are reused for the session while the file's size and modification time are
// unchanged (specs/inspect.md, Decisions). Sessions are told apart by their registry.

import type { DataSourceRegistry, ToolOutput } from "../../../contracts/index.ts";

export interface CacheKey {
  realPath: string;
  sizeBytes: number;
  modifiedTimeMs: number;
  /** The header override arguments, which change the profile. */
  options: string;
}

const cachesByRegistry = new WeakMap<DataSourceRegistry, Map<string, CachedProfile>>();

interface CachedProfile {
  key: CacheKey;
  output: ToolOutput;
}

export function cachedProfile(registry: DataSourceRegistry, key: CacheKey): ToolOutput | undefined {
  const cached = cachesByRegistry.get(registry)?.get(key.realPath);
  if (!cached || !sameKey(cached.key, key)) return undefined;
  // A registration made since (for example by another tool) must not be lost.
  if (registry.find(key.realPath) === undefined) return undefined;
  return cached.output;
}

export function rememberProfile(
  registry: DataSourceRegistry,
  key: CacheKey,
  output: ToolOutput,
): void {
  let cache = cachesByRegistry.get(registry);
  if (!cache) {
    cache = new Map();
    cachesByRegistry.set(registry, cache);
  }
  cache.set(key.realPath, { key, output });
}

function sameKey(left: CacheKey, right: CacheKey): boolean {
  return (
    left.sizeBytes === right.sizeBytes &&
    left.modifiedTimeMs === right.modifiedTimeMs &&
    left.options === right.options
  );
}
