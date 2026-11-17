// The arguments of `clankr index` and `/index`, which take the same flags (SRCH-9):
//
//   index                      list the indexed folders (same as --status)
//   index <folder>             index the folder, or bring its index up to date
//   index --rebuild <folder>   index it again from nothing (after changing the embedding model)
//   index --remove <folder>    delete its index

import type { IndexRequest } from "../contracts/index.ts";
import { tokenize } from "./attachments.ts";

export interface IndexFlags {
  status: boolean;
  rebuild: boolean;
  remove: boolean;
  /** Undefined when no folder was named. */
  folder: string | undefined;
}

export type IndexRequestResult = { ok: true; request: IndexRequest } | { ok: false; error: string };

export const indexFlagNames = ["status", "rebuild", "remove"] as const;

export function indexRequestFrom(flags: IndexFlags): IndexRequestResult {
  const chosen = indexFlagNames.filter((name) => flags[name]);
  if (chosen.length > 1) {
    return failure(`Use only one of ${chosen.map((name) => `--${name}`).join(", ")}.`);
  }
  if (flags.status) {
    if (flags.folder !== undefined) return failure("--status takes no folder.");
    return { ok: true, request: { action: "status" } };
  }
  if (flags.folder === undefined) {
    if (flags.remove || flags.rebuild) return failure(`--${chosen[0]} needs a folder.`);
    return { ok: true, request: { action: "status" } };
  }
  if (flags.remove) return { ok: true, request: { action: "remove", folder: flags.folder } };
  return { ok: true, request: { action: "build", folder: flags.folder, rebuild: flags.rebuild } };
}

/**
 * The text after `/index`. A folder may be quoted, have backslash-escaped spaces (as a path
 * dragged into the terminal does), or simply contain spaces.
 */
export function parseIndexArgumentText(argumentText: string): IndexRequestResult {
  const flags: IndexFlags = { status: false, rebuild: false, remove: false, folder: undefined };
  const folderWords: string[] = [];
  for (const token of tokenize(argumentText)) {
    const flag = token.quoted ? undefined : flagNamed(token.value);
    if (flag) flags[flag] = true;
    else if (!token.quoted && token.value.startsWith("--")) {
      return failure(`Unknown option ${token.value}. Use --status, --rebuild, or --remove.`);
    } else folderWords.push(token.value);
  }
  if (folderWords.length > 0) flags.folder = folderWords.join(" ");
  return indexRequestFrom(flags);
}

function flagNamed(word: string): (typeof indexFlagNames)[number] | undefined {
  return indexFlagNames.find((name) => word === `--${name}`);
}

function failure(error: string): IndexRequestResult {
  return { ok: false, error };
}
