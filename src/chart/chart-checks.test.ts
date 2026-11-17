// The field check and the axis polish, on the shapes a small model actually writes: facets,
// layered end labels with transforms, and years on a quantitative axis.

import { describe, expect, it } from "vitest";
import { polishAxes } from "./axis-polish.ts";
import { findMissingField } from "./field-check.ts";

const rows = [
  { place: "A", area: "North", year: 2001, indexed: 100 },
  { place: "A", area: "North", year: 2025, indexed: 180 },
];

const endLabelLayer = {
  transform: [
    { joinaggregate: [{ op: "max", field: "year", as: "last" }], groupby: ["place"] },
    { filter: "datum.year === datum.last" },
  ],
  mark: "text",
  encoding: { x: { field: "year", type: "quantitative" }, text: { field: "place" } },
};

describe("findMissingField", () => {
  it("catches a facet field that is not a column, and says how to add one", () => {
    const spec = {
      facet: { column: { field: "Metro", type: "nominal" } },
      spec: { mark: "line", encoding: { x: { field: "year", type: "quantitative" } } },
    };
    const message = findMissingField(spec, rows);
    expect(message).toMatch(/^facet\.column\.field: "Metro" is not a column/);
    expect(message).toMatch(/CASE WHEN/);
  });

  it("checks specs with transforms, counting the fields they create", () => {
    const spec = {
      layer: [{ ...endLabelLayer, encoding: { ...endLabelLayer.encoding, y: { field: "last" } } }],
    };
    expect(findMissingField(spec, rows)).toBeUndefined();
    const wrong = { layer: [{ ...endLabelLayer, encoding: { text: { field: "Place" } } }] };
    expect(findMissingField(wrong, rows)).toMatch(/"Place" is not a column/);
  });

  it("skips specs with a lookup, whose fields come from elsewhere", () => {
    const spec = {
      transform: [{ lookup: "id", from: { data: { name: "other" }, key: "id" } }],
      mark: "point",
      encoding: { x: { field: "fromOther" } },
    };
    expect(findMissingField(spec, rows)).toBeUndefined();
  });
});

describe("polishAxes", () => {
  it("draws year axes without a thousands separator", () => {
    const spec = {
      mark: "line",
      encoding: {
        x: { field: "year", type: "quantitative" },
        y: { field: "indexed", type: "quantitative" },
      },
    };
    polishAxes(spec, rows);
    expect(spec.encoding.x).toEqual({ field: "year", type: "quantitative", axis: { format: "d" } });
    // 100 and 180 are not years.
    expect(spec.encoding.y).toEqual({ field: "indexed", type: "quantitative" });
  });

  it("keeps a format the model chose", () => {
    const spec = {
      mark: "line",
      encoding: { x: { field: "year", type: "quantitative", axis: { format: ".0f" } } },
    };
    polishAxes(spec, rows);
    expect(spec.encoding.x.axis).toEqual({ format: ".0f" });
  });
});
