// Where an output file is written and what it is called (D28): named from a title, with a
// number appended when the name is taken. Nothing is ever overwritten.

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { formatFromPath } from "./formats.ts";

const maxNameLength = 60;
const maxNumberedAttempts = 999;

/** A file-name-safe base name from a title, or the fallback when nothing usable is left. */
export function slugFromTitle(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, maxNameLength)
    .replace(/-+$/, "");
  return slug || fallback;
}

/** `~` is the home folder; relative paths resolve against the working directory. */
export function resolveUserPath(path: string, workingDirectory: string): string {
  if (path === "~" || path.startsWith("~/")) return join(homedir(), path.slice(1));
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

/** Base name and folder from an explicit output path, which also gets a number if taken. */
export function splitOutputPath(path: string): { folder: string; baseName: string } {
  const extension = formatFromPath(path) ? extname(path) : "";
  return { folder: resolve(path, ".."), baseName: basename(path, extension) };
}

/**
 * The first free name: "sales", then "sales-2", "sales-3", and so on. `pathsFor` lists every
 * file that would be written under a name; the name is free when none of them exists.
 */
export async function firstFreeName(
  folder: string,
  baseName: string,
  pathsFor: (name: string) => string[],
): Promise<string> {
  for (let number = 1; number <= maxNumberedAttempts; number++) {
    const name = number === 1 ? baseName : `${baseName}-${number}`;
    if (!(await anyExists(pathsFor(name)))) return name;
  }
  throw new Error(`No free file name for ${baseName} in ${folder}`);
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      await access(path);
      return true;
    } catch {
      // Not there, which is what we want.
    }
  }
  return false;
}
