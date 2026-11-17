// Path attachments (CLI-10). A path dragged into a terminal arrives as text, often quoted
// or with backslash-escaped spaces. Paths that exist become attachments; the prose keeps
// a short label where the path was.

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment, TurnInput } from "../contracts/index.ts";

interface Token {
  start: number;
  end: number;
  value: string;
  quoted: boolean;
}

export interface AttachmentOptions {
  workingDirectory: string;
  /** Injected for tests. Defaults to "is an existing regular file". */
  isFile?: (path: string) => boolean;
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"]);
const trailingPunctuation = /[.,;:!?)]+$/;

export function extractAttachments(text: string, options: AttachmentOptions): TurnInput {
  const isFile = options.isFile ?? isExistingFile;
  const attachments: Attachment[] = [];
  let rewritten = "";
  let copiedUpTo = 0;
  for (const token of tokenize(text)) {
    const match = resolveAttachment(token, options.workingDirectory, isFile);
    if (!match) continue;
    attachments.push(match.attachment);
    rewritten += text.slice(copiedUpTo, token.start) + match.attachment.label;
    copiedUpTo = token.end - match.unusedSuffix.length;
  }
  rewritten += text.slice(copiedUpTo);
  return { text: rewritten, attachments };
}

function resolveAttachment(
  token: Token,
  workingDirectory: string,
  isFile: (path: string) => boolean,
): { attachment: Attachment; unusedSuffix: string } | undefined {
  if (!looksLikePath(token.value)) return undefined;
  // "see /tmp/a.png." should still attach /tmp/a.png and keep the full stop.
  const candidates = [token.value];
  if (!token.quoted) candidates.push(token.value.replace(trailingPunctuation, ""));
  for (const candidate of candidates) {
    const path = toAbsolutePath(candidate, workingDirectory);
    if (path && isFile(path)) {
      const unusedSuffix = token.value.slice(candidate.length);
      return { attachment: buildAttachment(path), unusedSuffix };
    }
  }
  return undefined;
}

function buildAttachment(path: string): Attachment {
  const kind = imageExtensions.has(extname(path).toLowerCase()) ? "image" : "file";
  return { path, kind, label: `[${basename(path)}]` };
}

function looksLikePath(value: string): boolean {
  return /^(\/|~\/|\.\.?\/|file:\/\/)/.test(value);
}

function toAbsolutePath(value: string, workingDirectory: string): string | undefined {
  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(workingDirectory, value);
}

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Splits on unescaped whitespace; quotes group, backslashes escape the next character. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text.charAt(index))) {
      index += 1;
      continue;
    }
    const token = readToken(text, index);
    tokens.push(token);
    index = token.end;
  }
  return tokens;
}

function readToken(text: string, start: number): Token {
  const opening = text.charAt(start);
  if (opening === "'" || opening === '"') {
    const closing = text.indexOf(opening, start + 1);
    if (closing > start) {
      return { start, end: closing + 1, value: text.slice(start + 1, closing), quoted: true };
    }
  }
  let value = "";
  let index = start;
  while (index < text.length && !/\s/.test(text.charAt(index))) {
    if (text.charAt(index) === "\\" && index + 1 < text.length) {
      value += text.charAt(index + 1);
      index += 2;
    } else {
      value += text.charAt(index);
      index += 1;
    }
  }
  return { start, end: index, value, quoted: false };
}
