// The default excludes (SRCH-7), defined once and shared by every search path:
// the Spotlight post-filter, the directory walk, `list_dir`, and ripgrep's globs.
//
// Pattern forms:
//   "node_modules"     a name, matched against any path segment (globs allowed)
//   "Library/Caches"   consecutive segments, matched anywhere below the root
//   "/System"          an absolute folder, excluded only when it lies below the root
//
// Every check works on the path relative to the search root. A root that is itself
// inside an excluded folder is therefore searched normally: the model asked for it.

import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import { globToRegExp } from "./glob.ts";

export const defaultExcludes: readonly string[] = [
  // Version control and dependency folders
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".gradle",
  // Caches and system bookkeeping inside the home folder and on volumes
  ".cache",
  ".npm",
  ".Trash",
  ".DS_Store",
  ".Spotlight-V100",
  ".fseventsd",
  ".DocumentRevisions-V100",
  ".TemporaryItems",
  "Library/Caches",
  "Library/Logs",
  "Library/Containers",
  "Library/Group Containers",
  "Library/Developer",
  "Library/Saved Application State",
  // System directories, which only matter when the whole machine is searched
  "/System",
  "/Library",
  "/private",
  "/dev",
  "/cores",
  "/usr",
  "/bin",
  "/sbin",
  "/opt",
];

/**
 * The per-call override (SRCH-7), shared by the search tools' parameters. There is no
 * switch to drop the defaults: a root inside an excluded folder is searched normally, so
 * the model reaches node_modules or .git by naming it as the root. Leaving the switch out
 * saves fixed overhead on every request (CTX-5).
 */
export const excludeParameters = {
  exclude: z.array(z.string()).optional().describe("More names or folders to skip"),
};

export function excludeRulesFor(
  root: string,
  args: { exclude?: string[] | undefined },
): ExcludeRules {
  return new ExcludeRules(root, { useDefaults: true, extra: args.exclude ?? [] });
}

export interface ExcludeOptions {
  /** False drops the default list; extra patterns still apply. */
  useDefaults: boolean;
  extra: string[];
}

interface CompiledPattern {
  /** Anchored patterns match only at the start of the relative path. */
  anchored: boolean;
  segments: RegExp[];
}

/** The exclude patterns for one search root, compiled once per call. */
export class ExcludeRules {
  readonly patterns: string[];
  private readonly compiled: CompiledPattern[];

  constructor(root: string, options: ExcludeOptions) {
    const all = [...(options.useDefaults ? defaultExcludes : []), ...options.extra];
    this.patterns = all
      .map((pattern) => relativePattern(root, pattern))
      .filter((pattern): pattern is string => pattern !== undefined);
    this.compiled = this.patterns.map((pattern) => ({
      anchored: pattern.startsWith("/"),
      segments: pattern.split("/").filter(Boolean).map(globToRegExp),
    }));
  }

  /** True when a path, given relative to the root, is or lies inside an excluded entry. */
  isExcluded(relativePath: string): boolean {
    const segments = relativePath.split(sep).filter(Boolean);
    return this.compiled.some((pattern) => matchesSegments(segments, pattern));
  }

  /** The same rules as ripgrep `--glob` arguments. */
  ripgrepGlobs(): string[] {
    return this.patterns.map((pattern) =>
      pattern.startsWith("/") || !pattern.includes("/") ? `!${pattern}` : `!**/${pattern}`,
    );
  }
}

/**
 * Turns an absolute exclude into one anchored at the root ("/" plus the relative path).
 * Returns undefined when the excluded folder is not below the root.
 */
function relativePattern(root: string, pattern: string): string | undefined {
  if (!isAbsolute(pattern)) return pattern.replace(/\/+$/, "");
  const inside = relative(root, pattern);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return undefined;
  return `/${inside.split(sep).join("/")}`;
}

/** True when the pattern's segments appear consecutively in the path's segments. */
function matchesSegments(segments: string[], pattern: CompiledPattern): boolean {
  const length = pattern.segments.length;
  if (length === 0) return false;
  const lastStart = pattern.anchored ? 0 : segments.length - length;
  for (let start = 0; start <= lastStart; start++) {
    const matches = pattern.segments.every((expression, offset) =>
      expression.test(segments[start + offset] ?? ""),
    );
    if (matches) return true;
  }
  return false;
}
