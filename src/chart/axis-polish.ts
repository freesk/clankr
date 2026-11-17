// Fixes the harness can make from the data alone, so the model does not have to know them,
// applied only where the model set no format of its own:
// - Years: a field of whole numbers from 1000 to 2999 is drawn as 2000, not "2,000".
// - Large numbers: a field reaching a million or more is drawn as 24B or 350M, not
//   "24,000,000,000".

import type { Row } from "../contracts/index.ts";
import { forEachView, isPlainObject, type SpecObject } from "./spec-tree.ts";

const positionChannels = ["x", "y", "x2", "y2"];

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
