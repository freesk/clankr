// A category with no value is drawn as a bar or series labelled "null". In a live run that
// bar held the largest total (payments with no date), and the model's summary ignored it.
// The harness cannot know whether those rows matter, so it tells the model, with numbers.

import type { Row } from "../contracts/index.ts";
import { forEachView, isPlainObject, type SpecObject } from "./spec-tree.ts";

const categoryChannels = ["x", "y", "color", "column", "row", "xOffset"];

/** One note per category field with empty values, or none. */
export function emptyCategoryNotes(spec: SpecObject, rows: Row[]): string[] {
  const notes: string[] = [];
  const checked = new Set<string>();
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    for (const channel of categoryChannels) {
      const definition = view.encoding[channel];
      if (!isPlainObject(definition) || typeof definition.field !== "string") continue;
      if (definition.type !== "nominal" && definition.type !== "ordinal") continue;
      if (checked.has(definition.field)) continue;
      checked.add(definition.field);
      const note = noteFor(definition.field, rows, numberFields(view.encoding));
      if (note) notes.push(note);
    }
  });
  return notes;
}

function noteFor(field: string, rows: Row[], measures: string[]): string | undefined {
  const empty = rows.filter(
    (row) => row[field] === null || row[field] === undefined || row[field] === "",
  );
  if (empty.length === 0) return undefined;
  const measure = measures[0];
  const total = measure
    ? empty.reduce(
        (sum, row) => sum + (typeof row[measure] === "number" ? (row[measure] as number) : 0),
        0,
      )
    : 0;
  const share =
    measure && total !== 0
      ? ` (${measure} ${total.toLocaleString("en-US", { maximumFractionDigits: 0 })})`
      : "";
  return (
    `${empty.length} ${empty.length === 1 ? "row has" : "rows have"} no "${field}"${share} and ` +
    `${empty.length === 1 ? "is" : "are"} shown as "(no ${field})". Filter them out in query_sql ` +
    `(WHERE "${field}" IS NOT NULL) or say what they are in the summary.`
  );
}

function numberFields(encoding: Record<string, unknown>): string[] {
  const fields: string[] = [];
  for (const definition of Object.values(encoding)) {
    if (isPlainObject(definition) && definition.type === "quantitative") {
      if (typeof definition.field === "string") fields.push(definition.field);
    }
  }
  return fields;
}

/**
 * Draws an empty category on an axis as "(no month)" rather than Vega's "null", which reads
 * like a data error. The rows themselves are not changed.
 */
export function labelEmptyCategories(spec: SpecObject, rows: Row[]): void {
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    for (const channel of ["x", "y"]) {
      const definition = view.encoding[channel];
      if (!isPlainObject(definition) || typeof definition.field !== "string") continue;
      if (definition.type !== "nominal" && definition.type !== "ordinal") continue;
      if (definition.axis === null) continue;
      const field = definition.field;
      if (!rows.some((row) => row[field] === null || row[field] === undefined)) continue;
      const axis = isPlainObject(definition.axis) ? definition.axis : {};
      if (axis.labelExpr !== undefined) continue;
      const label = `(no ${field})`.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
      definition.axis = { ...axis, labelExpr: `datum.value === null ? '${label}' : datum.label` };
    }
  });
}
