// Small fakes that several wave 1 parts need: a path policy with a fixed deny list,
// a read tracker, and a hand-filled data source registry.

import { isAbsolute, resolve, sep } from "node:path";
import type {
  DataSource,
  DataSourceRegistry,
  PathClassification,
  PathPolicy,
} from "../contracts/index.ts";

/**
 * Classifies by string prefix only: no symbolic link resolution, unlike the
 * real policy. Comparison is case-insensitive, as on the default macOS volume.
 */
export class FixedPathPolicy implements PathPolicy {
  readonly classified: string[] = [];
  private readonly allowedRoots: string[];
  private readonly deniedPaths: string[];
  private readonly workingDirectory: string;

  constructor(options: {
    allowedRoots: string[];
    deniedPaths?: string[];
    workingDirectory?: string;
  }) {
    this.workingDirectory = options.workingDirectory ?? options.allowedRoots[0] ?? process.cwd();
    this.allowedRoots = options.allowedRoots.map((root) => resolve(root));
    this.deniedPaths = (options.deniedPaths ?? []).map((path) => resolve(path));
  }

  async classify(path: string): Promise<PathClassification> {
    this.classified.push(path);
    const realPath = isAbsolute(path) ? resolve(path) : resolve(this.workingDirectory, path);
    if (this.deniedPaths.some((denied) => isInside(realPath, denied))) {
      return { realPath, pathClass: "denied" };
    }
    const allowed = this.allowedRoots.some((root) => isInside(realPath, root));
    return { realPath, pathClass: allowed ? "allowed" : "outside" };
  }
}

function isInside(path: string, folder: string): boolean {
  const candidate = path.toLowerCase();
  const parent = folder.toLowerCase();
  return candidate === parent || candidate.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** The real per-session tracker is small and has no side effects, so tests use it directly. */
export { SessionReadTracker as InMemoryReadTracker } from "../tools/search/read-tracker.ts";

export class InMemoryDataSourceRegistry implements DataSourceRegistry {
  private readonly sources: DataSource[] = [];

  constructor(sources: DataSource[] = []) {
    for (const source of sources) this.register(source);
  }

  register(source: DataSource): void {
    const existing = this.sources.findIndex((candidate) => candidate.realPath === source.realPath);
    if (existing >= 0) this.sources.splice(existing, 1);
    this.sources.push(source);
  }

  find(handleOrPath: string): DataSource | undefined {
    return this.sources.find(
      (source) => source.handle === handleOrPath || source.realPath === handleOrPath,
    );
  }

  findByTable(sqlName: string): DataSource | undefined {
    return this.sources.find((source) => source.tables.some((table) => table.sqlName === sqlName));
  }

  list(): DataSource[] {
    return [...this.sources];
  }
}
