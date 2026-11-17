import { describe, expect, it } from "vitest";
import { fitSpecToArea } from "./page-layout.ts";

const area = { width: 1000, height: 700 };
const rows = [
  { place: "A", area: "North" },
  { place: "B", area: "South" },
];

describe("fitSpecToArea for facets", () => {
  it("sizes facet panels to share the area instead of the 200 px default", () => {
    const spec = {
      facet: { column: { field: "area", type: "nominal" } },
      spec: { mark: "line" },
    };
    const fitted = fitSpecToArea(spec, area, rows) as { spec: { width: number; height: number } };
    expect(fitted.spec.width).toBeGreaterThan(400);
    expect(fitted.spec.height).toBeGreaterThan(500);
  });

  it("leaves room between panels for end-of-line labels", () => {
    const spec = {
      facet: { column: { field: "area", type: "nominal" } },
      spec: { layer: [{ mark: "line" }, { mark: { type: "text" } }] },
    };
    const fitted = fitSpecToArea(spec, area, rows) as { spacing: number };
    expect(fitted.spacing).toBeGreaterThanOrEqual(100);
  });

  it("keeps panel sizes the model set", () => {
    const spec = {
      facet: { column: { field: "area" } },
      spec: { mark: "line", width: 150, height: 90 },
    };
    expect(fitSpecToArea(spec, area, rows)).toBe(spec);
  });
});
