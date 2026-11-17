// Creating directories and files that only the user can read (SEC-5).
// Modes are set with chmod after creation, because the mode passed to mkdir and open
// is filtered through the umask and an existing directory keeps whatever it had.

import { chmod, mkdir, open } from "node:fs/promises";

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

export function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
