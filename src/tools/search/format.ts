// The compact result format (SRCH-6, PRD section 7.2): the root stated once, paths
// relative to it, sizes and dates in short human form. Every token saved here is a
// token the model can spend on the task.

import { homedir } from "node:os";
import { relative, sep } from "node:path";

const sizeUnits = ["KB", "MB", "GB", "TB"];

/** "812 B", "12 KB", "3.4 MB". One decimal only where it carries information. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < sizeUnits.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const rounded = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value).toString();
  return `${rounded} ${sizeUnits[unitIndex]}`;
}

/** Local calendar date, "2025-03-04". Models read ISO dates more reliably than "Mar 4". */
export function formatDate(timeMs: number): string {
  const date = new Date(timeMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The root as shown once at the top of a result: the home folder becomes "~". */
export function displayRoot(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(home + sep)) return `~${path.slice(home.length)}`;
  return path;
}

/**
 * A path as the model should pass it on: relative to the working folder when inside it,
 * otherwise in full with "~" for the home folder. Paths listed relative to some other search
 * root were passed on as-is and then resolved against the working folder, which failed.
 */
export function usablePath(realPath: string, workingDirectory: string): string {
  const relativePath = relativeDisplay(workingDirectory, realPath);
  return relativePath.startsWith("..") ? displayRoot(realPath) : relativePath;
}

/** A path as listed under its root: relative, with "/" separators. */
export function relativeDisplay(root: string, path: string): string {
  const inside = relative(root, path);
  return inside === "" ? "." : inside.split(sep).join("/");
}

/** Cuts a line to `maxLength` characters and says how long it really was. */
export function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength)} … [line cut, ${line.length.toLocaleString("en-US")} chars]`;
}

/** "1 file" / "3 files". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}
