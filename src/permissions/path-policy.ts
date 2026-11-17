// The real PathPolicy: canonicalize, then classify as denied, inside an allowed root,
// or outside. Search, image, and data tools call it before opening a file; the gate
// calls it for every path a change touches.

import { homedir } from "node:os";
import { basename } from "node:path";
import type { PathClassification, PathPolicy } from "../contracts/index.ts";
import { absolutePath, canonicalPath, comparisonKey, isSameOrInside } from "./canonical-path.ts";
import { defaultDeniedPaths, deniedFileNames } from "./deny-list.ts";

export interface PathPolicyOptions {
  /** From config, already resolved against the working directory by the loader. */
  allowedRoots: string[];
  /** `permissions.extraDeniedPaths` from config. */
  extraDeniedPaths?: string[];
  /** `VixPaths.root`. The harness's own files are denied to the model. */
  vixRoot: string;
  workingDirectory: string;
  homeDirectory?: string;
}

interface ResolvedFolders {
  allowedRoots: string[];
  deniedPaths: string[];
}

export class RealPathPolicy implements PathPolicy {
  private readonly options: PathPolicyOptions;
  private readonly homeDirectory: string;
  private resolvedFolders: Promise<ResolvedFolders> | undefined;

  constructor(options: PathPolicyOptions) {
    this.options = options;
    this.homeDirectory = options.homeDirectory ?? homedir();
  }

  async classify(path: string): Promise<PathClassification> {
    const absolute = this.absolute(path);
    const realPath = await canonicalPath(absolute);
    const folders = await this.folders();
    if (isDenied(realPath, folders.deniedPaths) || isDenied(absolute, folders.deniedPaths)) {
      return { realPath, pathClass: "denied" };
    }
    const allowed = folders.allowedRoots.some((root) => isSameOrInside(realPath, root));
    return { realPath, pathClass: allowed ? "allowed" : "outside" };
  }

  /** The deny list as configured, for `/permissions` to show. */
  async deniedPaths(): Promise<string[]> {
    return (await this.folders()).deniedPaths;
  }

  // Roots and deny entries are canonicalized too, once: `/etc` is really `/private/etc`,
  // and a user's `~/.ssh` may itself be a link into a dotfiles folder.
  private folders(): Promise<ResolvedFolders> {
    this.resolvedFolders ??= this.resolveFolders();
    return this.resolvedFolders;
  }

  private async resolveFolders(): Promise<ResolvedFolders> {
    const denied = [
      ...defaultDeniedPaths(),
      ...(this.options.extraDeniedPaths ?? []),
      this.options.vixRoot,
    ].map((path) => this.absolute(path));
    const allowed = this.options.allowedRoots.map((path) => this.absolute(path));
    return {
      // Both spellings are kept for denied entries, so neither a link nor its target slips by.
      deniedPaths: unique([...denied, ...(await Promise.all(denied.map(canonicalPath)))]),
      allowedRoots: await Promise.all(allowed.map(canonicalPath)),
    };
  }

  private absolute(path: string): string {
    return absolutePath(path, this.homeDirectory, this.options.workingDirectory);
  }
}

function isDenied(path: string, deniedPaths: string[]): boolean {
  const name = comparisonKey(basename(path));
  if (deniedFileNames.some((denied) => comparisonKey(denied) === name)) return true;
  return deniedPaths.some((denied) => isSameOrInside(path, denied));
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}
