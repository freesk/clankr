// Creating directories and files that only the user can read (SEC-5).
// Modes are set with chmod after creation, because the mode passed to mkdir and open
// is filtered through the umask and an existing directory keeps whatever it had.

import { chmod, mkdir, open, rename } from "node:fs/promises";

export const privateDirectoryMode = 0o700;
export const privateFileMode = 0o600;

/** Creates the directory if needed and sets it to 0700. Parents must already be private. */
export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: privateDirectoryMode });
  await chmod(path, privateDirectoryMode);
}

/** Creates each directory in order, so every level ends up 0700. */
export async function ensurePrivateDirectories(paths: string[]): Promise<void> {
  for (const path of paths) await ensurePrivateDirectory(path);
}

/** Appends text to a file that is created, or kept, at 0600. */
export async function appendPrivateFile(path: string, text: string): Promise<void> {
  const handle = await open(path, "a", privateFileMode);
  try {
    await handle.chmod(privateFileMode);
    await handle.appendFile(text, "utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Replaces a file with text, at 0600. The text goes to a temporary file next to it first,
 * so a crash mid-write never leaves a half-written file. The directory must already exist.
 */
export async function writePrivateFile(path: string, text: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const handle = await open(temporaryPath, "w", privateFileMode);
  try {
    await handle.chmod(privateFileMode);
    await handle.writeFile(text, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
}

export function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
