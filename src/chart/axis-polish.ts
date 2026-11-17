// Fixes the harness can make from the data alone, so the model does not have to know them.
// A quantitative axis over years is drawn with a thousands separator ("2,000"); when every
// value of the field is a whole number from 1000 to 2999, it is a year and gets `format: "d"`.

import type { Row } from "../contracts/index.ts";
import { forEachView, isPlainObject, type SpecObject } from "./spec-tree.ts";

const positionChannels = ["x", "y", "x2", "y2"];

export function polishAxes(spec: SpecObject, rows: Row[]): void {
  forEachView(spec, (view) => {
    if (!isPlainObject(view.encoding)) return;
    for (const channel of positionChannels) {
      const definition = view.encoding[channel];
      if (!isPlainObject(definition) || definition.type !== "quantitative") continue;
      if (typeof definition.field !== "string" || !looksLikeYears(rows, definition.field)) continue;
      if (definition.axis === null) continue;
      const axis = isPlainObject(definition.axis) ? definition.axis : {};
      if (axis.format === undefined) definition.axis = { ...axis, format: "d" };
    }
  });
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
