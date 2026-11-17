// Fixes the harness can make from the spec and data alone, so the model does not have to
// know them. Axes, applied only where the model set no format of its own:
// - Years: a field of whole numbers from 1000 to 2999 is drawn as 2000, not "2,000".
// - Large numbers: a field reaching a million or more is drawn as 24B or 350M, not
//   "24,000,000,000".
// Legends: a coloured series with its legend hidden and no text labels anywhere gets its legend
// back. A small model copies `legend: null` from the end-label example into charts that have no
// labels, leaving lines nobody can tell apart.

import type { Row } from "../contracts/index.ts";
import { forEachView, isPlainObject, type SpecObject } from "./spec-tree.ts";

const positionChannels = ["x", "y", "x2", "y2"];

export function polishSpec(spec: SpecObject, rows: Row[]): void {
  barsOverYearsAsCategories(spec, rows);
  polishAxes(spec, rows);
  angleLongCategoryLabels(spec, rows);
  restoreHiddenLegends(spec);
}

/**
 * Bars on a continuous year axis are drawn as hairlines (a bar gets one pixel per year of a
 * continuous scale). For bar marks, a year field is drawn as ordered categories instead.
 */
function barsOverYearsAsCategories(spec: SpecObject, rows: Row[]): void {
  forEachView(spec, (view) => {
    const mark = isPlainObject(view.mark) ? view.mark.type : view.mark;
    if (mark !== "bar" || !isPlainObject(view.encoding)) return;
    for (const channel of ["x", "y"]) {
      const definition = view.encoding[channel];
      if (!isPlainObject(definition) || definition.type !== "quantitative") continue;
      if (typeof definition.field !== "string" || "aggregate" in definition) continue;
      if (looksLikeYears(rows, definition.field)) definition.type = "ordinal";
    }
  });
}

/** Category labels longer than this are angled instead of being turned on their side. */
const longLabelCharacters = 10;

/**
 * Vega-Lite turns long category labels on an x axis 90 degrees, which is hard to read.
 * They are angled at -35 degrees instead, unless the model chose an angle.
 */
function angleLongCategoryLabels(spec: SpecObject, rows: Row[]): void {
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    const definition = view.encoding.x;
    if (!isPlainObject(definition) || typeof definition.field !== "string") return;
    if (definition.type !== "nominal" && definition.type !== "ordinal") return;
    if (definition.axis === null) return;
    const field = definition.field;
    const longest = Math.max(0, ...rows.map((row) => String(row[field] ?? "").length));
    if (longest <= longLabelCharacters) return;
    const axis = isPlainObject(definition.axis) ? definition.axis : {};
    if (axis.labelAngle !== undefined) return;
    definition.axis = { ...axis, labelAngle: -35, labelAlign: "right" };
  });
}

const legendChannels = ["color", "fill", "stroke", "shape", "strokeDash"];

function restoreHiddenLegends(spec: SpecObject): void {
  let hasTextMarks = false;
  forEachView(spec, (view) => {
    const mark = isPlainObject(view.mark) ? view.mark.type : view.mark;
    if (mark === "text") hasTextMarks = true;
  });
  if (hasTextMarks) return;
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    for (const channel of legendChannels) {
      const definition = view.encoding[channel];
      if (isPlainObject(definition) && definition.legend === null && "field" in definition) {
        delete definition.legend;
      }
    }
  });
}

export function polishAxes(spec: SpecObject, rows: Row[]): void {
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    for (const channel of positionChannels) {
      const definition = view.encoding[channel];
      if (!isPlainObject(definition) || definition.type !== "quantitative") continue;
      if (typeof definition.field !== "string" || definition.axis === null) continue;
      const axis = isPlainObject(definition.axis) ? definition.axis : {};
      if (axis.format !== undefined || axis.labelExpr !== undefined) continue;
      const field = definition.field;
      if (looksLikeYears(rows, field)) definition.axis = { ...axis, format: "d" };
      else if (largestMagnitude(rows, field) >= 1e6) {
        definition.axis = { ...axis, labelExpr: shortLargeNumbers };
      }
    }
  });
}

/** A Vega expression: 24000000000 → "24B", 350000000 → "350M", 1200 → "1,200". */
const shortLargeNumbers =
  "abs(datum.value) >= 1e9 ? format(datum.value / 1e9, '~') + 'B' : " +
  "abs(datum.value) >= 1e6 ? format(datum.value / 1e6, '~') + 'M' : format(datum.value, ',')";

function largestMagnitude(rows: Row[], field: string): number {
  let largest = 0;
  for (const row of rows) {
    const value = row[field];
    if (typeof value === "number" && Number.isFinite(value))
      largest = Math.max(largest, Math.abs(value));
  }
  return largest;
}

function looksLikeYears(rows: Row[], field: string): boolean {
  let seen = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > 2999) {
      return false;
    }
    seen += 1;
  }
  return seen > 0;
}
