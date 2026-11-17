// Months on a chart belong in time order. A small model copies `sort: "-y"` from the bar
// example, so a "per month of the fiscal year" chart came out sorted by size. When every
// category of a field is a month name, the months are put in time order: the order of the
// rows if that is a run of consecutive months (a fiscal year from April), else January first.

import type { Row } from "../contracts/index.ts";
import { forEachView, isPlainObject, type SpecObject } from "./spec-tree.ts";

const shortMonths = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** 0 for January … 11 for December, or undefined for anything that is not a month name. */
function monthIndex(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const index = shortMonths.indexOf(value.trim().slice(0, 3).toLowerCase());
  return index === -1 ? undefined : index;
}

/** Returns notes for the model about each field it re-ordered. */
export function keepMonthsInTimeOrder(spec: SpecObject, rows: Row[]): string[] {
  const notes: string[] = [];
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    for (const channel of ["x", "y"]) {
      const definition = view.encoding[channel];
      if (!isPlainObject(definition) || typeof definition.field !== "string") continue;
      if (definition.type !== "nominal" && definition.type !== "ordinal") continue;
      const order = monthOrder(rows, definition.field);
      if (!order || Array.isArray(definition.sort)) continue;
      definition.sort = order;
      notes.push(`Kept the months of "${definition.field}" in time order.`);
    }
  });
  return notes;
}

/** The months as they should appear, or undefined when the field is not all month names. */
function monthOrder(rows: Row[], field: string): string[] | undefined {
  const seen: string[] = [];
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    if (monthIndex(value) === undefined) return undefined;
    if (!seen.includes(value as string)) seen.push(value as string);
  }
  if (seen.length < 2) return undefined;
  return isConsecutive(seen)
    ? seen
    : [...seen].sort((a, b) => (monthIndex(a) ?? 0) - (monthIndex(b) ?? 0));
}

/** True when each month follows the one before it, wrapping from December to January. */
function isConsecutive(months: string[]): boolean {
  return months.every((month, index) => {
    if (index === 0) return true;
    return monthIndex(month) === ((monthIndex(months[index - 1]) ?? 0) + 1) % 12;
  });
}
