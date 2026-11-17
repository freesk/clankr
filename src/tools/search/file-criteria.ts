// The filters of `find_files`, parsed once from the flat tool arguments. Spotlight
// uses them to narrow its query and the walk uses them directly; both then run the
// same `matchesCriteria` check, so either backend returns exactly the same files.

import type { Stats } from "node:fs";
import { ToolError } from "../../contracts/index.ts";
import { type FileKind, isOfKind } from "./file-kinds.ts";
import { nameMatcher } from "./glob.ts";

export interface FileCriteria {
  pattern?: string;
  /** The compiled pattern, built once because the walk calls it for every entry. */
  nameTest?: (name: string) => boolean;
  kind?: FileKind;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  modifiedAfterMs?: number;
  modifiedBeforeMs?: number;
  createdAfterMs?: number;
  createdBeforeMs?: number;
}

export interface CriteriaArguments {
  pattern?: string | undefined;
  type?: FileKind | undefined;
  min_size?: string | number | undefined;
  max_size?: string | number | undefined;
  modified_after?: string | undefined;
  modified_before?: string | undefined;
  created_after?: string | undefined;
  created_before?: string | undefined;
}

export function parseCriteria(args: CriteriaArguments, nowMs = Date.now()): FileCriteria {
  const criteria: FileCriteria = {};
  const pattern = args.pattern?.trim();
  if (pattern) {
    criteria.pattern = pattern;
    criteria.nameTest = nameMatcher(pattern);
  }
  if (args.type) criteria.kind = args.type;
  if (args.min_size !== undefined) criteria.minSizeBytes = parseSize(args.min_size, "min_size");
  if (args.max_size !== undefined) criteria.maxSizeBytes = parseSize(args.max_size, "max_size");
  const dates = [
    ["modified_after", "modifiedAfterMs"],
    ["modified_before", "modifiedBeforeMs"],
    ["created_after", "createdAfterMs"],
    ["created_before", "createdBeforeMs"],
  ] as const;
  for (const [argumentName, field] of dates) {
    const value = args[argumentName];
    if (value?.trim()) criteria[field] = parseDate(value, argumentName, nowMs);
  }
  return criteria;
}

/** Whether a found entry satisfies every filter. Name and kind first: they need no stat. */
export function matchesCriteria(name: string, stats: Stats, criteria: FileCriteria): boolean {
  return matchesNameAndKind(name, stats.isDirectory(), criteria) && matchesStats(stats, criteria);
}

export function matchesNameAndKind(
  name: string,
  isDirectory: boolean,
  criteria: FileCriteria,
): boolean {
  if (criteria.nameTest && !criteria.nameTest(name)) return false;
  if (criteria.kind && !isOfKind(name, isDirectory, criteria.kind)) return false;
  return true;
}

function matchesStats(stats: Stats, criteria: FileCriteria): boolean {
  const sizeFiltered = criteria.minSizeBytes !== undefined || criteria.maxSizeBytes !== undefined;
  // A folder's own size says nothing about its contents, so size filters exclude folders.
  if (sizeFiltered && stats.isDirectory()) return false;
  return (
    atLeast(stats.size, criteria.minSizeBytes) &&
    atMost(stats.size, criteria.maxSizeBytes) &&
    atLeast(stats.mtimeMs, criteria.modifiedAfterMs) &&
    below(stats.mtimeMs, criteria.modifiedBeforeMs) &&
    atLeast(stats.birthtimeMs, criteria.createdAfterMs) &&
    below(stats.birthtimeMs, criteria.createdBeforeMs)
  );
}

function atLeast(value: number, bound: number | undefined): boolean {
  return bound === undefined || value >= bound;
}

function atMost(value: number, bound: number | undefined): boolean {
  return bound === undefined || value <= bound;
}

function below(value: number, bound: number | undefined): boolean {
  return bound === undefined || value < bound;
}

const sizeMultipliers: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};

/** "10MB", "500 kb", "1.5 GB", or a plain number of bytes. */
export function parseSize(value: string | number, argumentName: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(String(value));
  const multiplier = sizeMultipliers[(match?.[2] || "b").toLowerCase()];
  if (!match || multiplier === undefined) {
    throw new ToolError(
      `${argumentName} "${value}" is not a size. Use a form like "10MB" or "500KB".`,
    );
  }
  return Math.round(Number(match[1]) * multiplier);
}

const dayMs = 86_400_000;

/** Keyed by the first letter of the unit the model wrote. A month is 30 days, a year 365. */
const relativeUnitsMs: Record<string, number> = {
  h: 3_600_000,
  d: dayMs,
  w: 7 * dayMs,
  m: 30 * dayMs,
  y: 365 * dayMs,
};

/**
 * "2025-01-31" (local midnight), a full ISO timestamp, "today", "yesterday",
 * or a relative age such as "7d", "2 weeks", "3 months ago".
 */
export function parseDate(value: string, argumentName: string, nowMs = Date.now()): number {
  const text = value.trim().toLowerCase();
  if (text === "today") return startOfDay(nowMs);
  if (text === "yesterday") return startOfDay(nowMs) - dayMs;

  const relativeMatch = /^(\d+)\s*(h|hours?|d|days?|w|weeks?|m|months?|y|years?)(\s+ago)?$/.exec(
    text,
  );
  if (relativeMatch) {
    const unitLetter = (relativeMatch[2] ?? "d").charAt(0);
    return nowMs - Number(relativeMatch[1]) * (relativeUnitsMs[unitLetter] ?? dayMs);
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime();
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ToolError(
      `${argumentName} "${value}" is not a date. Use "2025-01-31" or a relative age like "7d".`,
    );
  }
  return parsed;
}

function startOfDay(timeMs: number): number {
  const date = new Date(timeMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
