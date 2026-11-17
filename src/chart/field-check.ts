// A field name that is not a column draws an empty chart without any error from Vega-Lite,
// and it is the mistake a small model makes most. Checked here so the model is told which
// columns exist. Only specs without transforms, repeats, or nested field paths are checked,
// because those can create or rename fields and a wrong "missing" error would be worse than none.

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
  const missing = encodedFields(spec).find((use) => !columns.has(use.field));
  if (!missing) return undefined;
  return `${missing.location}: "${missing.field}" is not a column. Columns are: ${[...columns].map((column) => JSON.stringify(column)).join(", ")}.`;
}

function isCheckable(spec: SpecObject): boolean {
  let checkable = !("repeat" in spec);
  forEachView(spec, (view) => {
    if (Array.isArray(view.transform) && view.transform.length > 0) checkable = false;
  });
  return checkable;
}

function encodedFields(spec: SpecObject): FieldUse[] {
  const uses: FieldUse[] = [];
  forEachView(spec, (view, location) => {
    if (!isPlainObject(view.encoding)) return;
    for (const [channel, definition] of Object.entries(view.encoding)) {
      const channelLocation = joinLocation(location, `encoding.${channel}`);
      const definitions = Array.isArray(definition) ? definition : [definition];
      for (const item of definitions) {
        const field = isPlainObject(item) ? item.field : undefined;
        // Dots and brackets address nested values; those are left to Vega-Lite.
        if (typeof field === "string" && !/[.[\]\\]/.test(field)) {
          uses.push({ field, location: `${channelLocation}.field` });
        }
      }
    }
  });
  return uses;
}
