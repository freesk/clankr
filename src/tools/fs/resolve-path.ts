// Turning a path from the model into a path these tools act on, refusing protected paths.
// The permission gate also checks the deny list; checking here too means a gate bug
// can never let a write tool touch `~/.ssh` (defence in depth, PERM-4).

import { basename, join, relative } from "node:path";
import { type ToolContext, ToolError } from "../../contracts/index.ts";

/** The real path of a file whose contents are read or written, following symbolic links. */
export async function resolveContentPath(path: string, context: ToolContext): Promise<string> {
  const { realPath, pathClass } = await context.paths.classify(path);
  if (pathClass === "denied") throw protectedPathError(path);
  return realPath;
}

/**
 * The path of an entry that is moved, copied, or trashed as a whole. The folder it sits in
 * is resolved, but the entry itself is not, so trashing a symbolic link trashes the link
 * and not the file it points to.
 */
export async function resolveEntryPath(path: string, context: ToolContext): Promise<string> {
  const name = basename(path);
  if (name === "" || name === "." || name === ".." || name === "~") {
    throw new ToolError(`"${path}" does not name a file or folder. Give the full path.`);
  }
  // Classifying the entry itself checks the deny list against wherever it really leads.
  await resolveContentPath(path, context);
  const parent = await resolveContentPath(join(path, ".."), context);
  return join(parent, name);
}

function protectedPathError(path: string): ToolError {
  return new ToolError(`${path} is a protected path and cannot be changed. Choose another path.`);
}

/** A short path for messages: relative to the working directory when inside it. */
export function displayPath(path: string, context: ToolContext): string {
  const relativePath = relative(context.workingDirectory, path);
  if (relativePath === "") return ".";
  if (relativePath.startsWith("..") || relativePath.startsWith("/")) return path;
  return relativePath;
}
