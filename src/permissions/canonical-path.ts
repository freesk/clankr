// Turning whatever path the model wrote into the real path the file system would use.
// Classification is only sound on real paths: otherwise a symbolic link inside an
// allowed root could point at `~/.ssh` and pass a prefix check.

import { lstat, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** More links than this in one chain is a loop, as the kernel's own limit treats it. */
const maxSymbolicLinkHops = 40;

/** `~` and `~/x` become the home folder; anything else is returned unchanged. */
export function expandHome(path: string, homeDirectory: string): string {
  if (path === "~") return homeDirectory;
  if (path.startsWith("~/")) return join(homeDirectory, path.slice(2));
  return path;
}

/** Absolute, with `~` expanded and `.`/`..` segments resolved, but links not yet followed. */
export function absolutePath(
  path: string,
  homeDirectory: string,
  workingDirectory: string,
): string {
  const expanded = expandHome(path, homeDirectory);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workingDirectory, expanded);
}

/**
 * The real path, with every symbolic link followed. A path that does not exist yet
 * is resolved through its nearest existing parent, and a dangling link is followed
 * to where it points, because writing through it would create the file there.
 */
export async function canonicalPath(absolute: string): Promise<string> {
  return canonicalize(absolute, 0);
}

async function canonicalize(absolute: string, hops: number): Promise<string> {
  if (hops > maxSymbolicLinkHops) throw new Error(`Too many symbolic links resolving ${absolute}`);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const linkTarget = await danglingLinkTarget(absolute);
  if (linkTarget !== undefined) {
    return canonicalize(resolve(dirname(absolute), linkTarget), hops + 1);
  }
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(await canonicalize(parent, hops), basename(absolute));
}

async function danglingLinkTarget(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink() ? await readlink(path) : undefined;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * The form two paths are compared in. The default macOS volume ignores case and
 * Unicode normalization, so `/Users/Me/.SSH` and `/users/me/.ssh` are the same folder.
 */
export function comparisonKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export function isSameOrInside(path: string, folder: string): boolean {
  const candidate = comparisonKey(path);
  const parent = comparisonKey(folder);
  if (candidate === parent) return true;
  return candidate.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
