// The field check and the axis polish, on the shapes a small model actually writes: facets,
// layered end labels with transforms, and years on a quantitative axis.

import { describe, expect, it } from "vitest";
import { findMissingField } from "./field-check.ts";
import { polishAxes, polishSpec } from "./spec-polish.ts";

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

  it("draws axes over large numbers as 24B or 350M", () => {
    const spec = {
      mark: "bar",
      encoding: {
        x: { field: "total", type: "quantitative" },
        y: { field: "ministry", type: "nominal" },
      },
    };
    polishAxes(spec, [
      { ministry: "Health", total: 25_857_200_000 },
      { ministry: "Education", total: 6_747_800_000 },
    ]);
    const axis = (spec.encoding.x as { axis?: { labelExpr?: string } }).axis;
    expect(axis?.labelExpr).toContain("'B'");
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

describe("polishSpec legends", () => {
  it("brings back a hidden legend when nothing else labels the series", () => {
    const spec = {
      mark: "line",
      encoding: {
        x: { field: "year", type: "quantitative" },
        color: { field: "place", type: "nominal", legend: null },
      },
    };
    polishSpec(spec, rows);
    expect(spec.encoding.color).toEqual({ field: "place", type: "nominal" });
  });

  it("keeps the legend hidden when text labels name the series", () => {
    const color = { field: "place", type: "nominal", legend: null };
    const spec = { layer: [{ mark: "line", encoding: { color } }, { ...endLabelLayer }] };
    polishSpec(spec, rows);
    expect(color.legend).toBeNull();
  });
});

describe("polishSpec bars and labels", () => {
  it("draws bars over years as categories, not hairlines on a continuous axis", () => {
    const spec = {
      mark: "bar",
      encoding: {
        x: { field: "year", type: "quantitative" },
        y: { field: "indexed", type: "quantitative" },
      },
    };
    polishSpec(spec, rows);
    expect(spec.encoding.x.type).toBe("ordinal");
    expect(spec.encoding.y.type).toBe("quantitative");
  });

  it("angles long category labels instead of turning them on their side", () => {
    const spec = {
      mark: "bar",
      encoding: {
        x: { field: "purpose", type: "nominal" },
        y: { field: "n", type: "quantitative" },
      },
    };
    polishSpec(spec, [{ purpose: "Other Purpose Specified by the Director", n: 644 }]);
    expect((spec.encoding.x as { axis?: { labelAngle?: number } }).axis?.labelAngle).toBe(-35);
  });
});

describe("polishSpec short category labels", () => {
  it("draws short labels such as years level", () => {
    const spec = {
      mark: "bar",
      encoding: { x: { field: "year", type: "ordinal" }, y: { field: "n", type: "quantitative" } },
    };
    polishSpec(spec, [{ year: 2020, n: 1 }]);
    expect((spec.encoding.x as { axis?: { labelAngle?: number } }).axis?.labelAngle).toBe(0);
  });
});
