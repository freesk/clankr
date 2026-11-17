// Problems with a search index that the user (or, through the tool, the model) can act on.
// The message says what is wrong and what to do; it carries no stack trace or secret.

import { LmStudioError } from "../lmstudio/index.ts";

export class SearchIndexError extends Error {
  override readonly name = "SearchIndexError";
}

export function modelMismatch(
  root: string,
  builtWith: string,
  configured: string,
): SearchIndexError {
  return new SearchIndexError(
    `The index for ${root} was built with the embedding model "${builtWith}", but ` +
      `search.embeddingModel is now "${configured}". ${rebuildHint(root)}`,
  );
}

export function dimensionMismatch(
  root: string,
  indexed: number,
  returned: number,
): SearchIndexError {
  return new SearchIndexError(
    `The index for ${root} holds ${indexed}-number vectors, but the embedding model now returns ` +
      `${returned}. ${rebuildHint(root)}`,
  );
}

/** A damaged index file, or one written by something that is not clankr. */
export function unreadableIndex(root: string, cause: unknown): SearchIndexError {
  const detail = cause instanceof Error ? (cause.message.split("\n")[0] ?? "") : String(cause);
  return new SearchIndexError(
    `The index for ${root} cannot be read (${detail}). ${rebuildHint(root)}`,
  );
}

/** Names both ways in: the subcommand, and the slash command inside the REPL. */
function rebuildHint(root: string): string {
  return `Rebuild it with \`clankr index --rebuild ${root}\` (inside clankr: \`/index --rebuild ${root}\`).`;
}

export function indexInUse(root: string): SearchIndexError {
  return new SearchIndexError(
    `The index for ${root} is in use by another clankr process. Try again when it has finished.`,
  );
}

/**
 * The text to show for a failure the user can fix, or undefined for anything else (a bug,
 * which the caller lets propagate). LM Studio errors carry their own fix (MOD-8).
 */
export function describeIndexFailure(error: unknown): string | undefined {
  if (error instanceof SearchIndexError) return error.message;
  if (error instanceof LmStudioError) return error.describe();
  return undefined;
}
