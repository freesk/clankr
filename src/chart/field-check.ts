// A field name that is not a column draws an empty chart, or an "undefined" panel header,
// without any error from Vega-Lite, and it is the mistake a small model makes most. Checked
// here so the model is told which columns exist. Fields that transforms create (`calculate`,
// `window`, `aggregate`, `fold`, …) count as columns. Repeats, lookups, and nested field paths
// are not checked, because there a wrong "missing" error would be worse than none.

import type { Row } from "../contracts/index.ts";
import { forEachView, isPlainObject, joinLocation, type SpecObject } from "./spec-tree.ts";

interface FieldUse {
  field: string;
  location: string;
}

/** Returns a message for the first field that is not a column, or undefined. */
export function findMissingField(spec: SpecObject, rows: Row[]): string | undefined {
  if (rows.length === 0 || !isCheckable(spec)) return undefined;
  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  const known = new Set([...columns, ...fieldsCreatedByTransforms(spec)]);
  const missing = usedFields(spec).find((use) => !known.has(use.field));
  if (!missing) return undefined;
  const listed = [...columns].map((column) => JSON.stringify(column)).join(", ");
  return (
    `${missing.location}: "${missing.field}" is not a column. Columns are: ${listed}. ` +
    "To group or relabel rows, add the column in query_sql (for example with CASE WHEN)."
  );
}

function isCheckable(spec: SpecObject): boolean {
  let checkable = !("repeat" in spec);
  forEachView(spec, (view) => {
    if (!Array.isArray(view.transform)) return;
    // A lookup brings in fields from another data source this check cannot see.
    if (view.transform.some((step) => isPlainObject(step) && "lookup" in step)) checkable = false;
  });
  return checkable;
}

/** Output names of every transform in the spec. */
function fieldsCreatedByTransforms(spec: SpecObject): string[] {
  const created: string[] = [];
  forEachView(spec, (view) => {
    if (!Array.isArray(view.transform)) return;
    for (const step of view.transform) if (isPlainObject(step)) collectOutputNames(step, created);
  });
  return created;
}

// `as` can be a string, an array of strings, or sit inside the items of `window`,
// `aggregate`, and `joinaggregate` operations.
function collectOutputNames(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectOutputNames(item, into);
    return;
  }
  if (!isPlainObject(value)) return;
  const as = value.as;
  if (typeof as === "string") into.push(as);
  if (Array.isArray(as)) for (const name of as) if (typeof name === "string") into.push(name);
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested) || isPlainObject(nested)) collectOutputNames(nested, into);
  }
}

function usedFields(spec: SpecObject): FieldUse[] {
  const uses: FieldUse[] = [];
  forEachView(spec, (view, location) => {
    if (isPlainObject(view.encoding)) {
      for (const [channel, definition] of Object.entries(view.encoding)) {
        addFieldUses(definition, joinLocation(location, `encoding.${channel}`), uses);
      }
    }
    // A facet operator: { facet: { field } } or { facet: { row: {field}, column: {field} } }.
    if (isPlainObject(view.facet)) {
      addFieldUses(view.facet, joinLocation(location, "facet"), uses);
      for (const key of ["row", "column"]) {
        addFieldUses(view.facet[key], joinLocation(location, `facet.${key}`), uses);
      }
    }
  });
  return uses;
}

function addFieldUses(definition: unknown, location: string, uses: FieldUse[]): void {
  const definitions = Array.isArray(definition) ? definition : [definition];
  for (const item of definitions) {
    const field = isPlainObject(item) ? item.field : undefined;
    // Dots and brackets address nested values; those are left to Vega-Lite.
    if (typeof field === "string" && !/[.[\]\\]/.test(field)) {
      uses.push({ field, location: `${location}.field` });
    }
    // A conditional definition can name a field too.
    if (isPlainObject(item) && isPlainObject(item.condition)) {
      addFieldUses(item.condition, `${location}.condition`, uses);
    }
  }
}
