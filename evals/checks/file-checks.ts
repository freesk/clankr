// Assertions on the state of the task's working directory.

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { hashFile } from "../fixtures/materialize.ts";
import type { AssertionContext, CheckResult } from "./types.ts";

export async function checkFileExists(context: AssertionContext, path: string): CheckResult {
  return (await isFile(join(context.workingDirectory, path)))
    ? undefined
    : `${path} does not exist`;
}

export async function checkDirectoryExists(context: AssertionContext, path: string): CheckResult {
  try {
    if ((await stat(join(context.workingDirectory, path))).isDirectory()) return undefined;
    return `${path} is not a folder`;
  } catch {
    return `${path} does not exist`;
  }
}

export async function checkFileAbsent(context: AssertionContext, path: string): CheckResult {
  return (await pathExists(join(context.workingDirectory, path)))
    ? `${path} still exists`
    : undefined;
}

export async function checkFileContains(
  context: AssertionContext,
  path: string,
  text: string,
  expected: boolean,
): CheckResult {
  const content = await readTextOrUndefined(join(context.workingDirectory, path));
  if (content === undefined) return `${path} does not exist`;
  const found = content.includes(text);
  if (found === expected) return undefined;
  return expected ? `${path} does not contain "${text}"` : `${path} still contains "${text}"`;
}

export async function checkFileUnchanged(context: AssertionContext, path: string): CheckResult {
  const originalHash = context.fixtureSnapshot.get(path);
  if (!originalHash) return `${path} is not a fixture, so it has no original to compare with`;
  const absolutePath = join(context.workingDirectory, path);
  if (!(await isFile(absolutePath))) return `${path} no longer exists`;
  return (await hashFile(absolutePath)) === originalHash ? undefined : `${path} was modified`;
}

export async function checkFileCount(
  context: AssertionContext,
  directory: string,
  suffix: string,
  expectedCount: number,
): CheckResult {
  let entries: Dirent[];
  try {
    entries = await readdir(join(context.workingDirectory, directory), { withFileTypes: true });
  } catch {
    return `${directory} does not exist`;
  }
  const count = entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix)).length;
  if (count === expectedCount) return undefined;
  return `${directory} has ${count} files ending in "${suffix}", expected ${expectedCount}`;
}

/** Every file under the folder, recursively, as absolute paths. */
export async function listFilesRecursively(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function readTextOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
