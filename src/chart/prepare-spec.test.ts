// Starting from a captured spec and rows, as specs/chart.md asks: no isolate involved.

import { describe, expect, it } from "vitest";
import { type Row, ToolError } from "../contracts/index.ts";
import { isBrowserVendored } from "../engines/browser/index.ts";
import { defaultTheme } from "./default-theme.ts";
import { prepareChartSpec } from "./prepare-spec.ts";

const rows = [
  { month: "2026-01", region: "North", revenue: 120 },
  { month: "2026-02", region: "South", revenue: 80 },
];
const options = { theme: defaultTheme, rowCap: 1_000 };

const barSpec = {
  title: "Revenue",
  mark: "bar",
  encoding: {
    x: { field: "region", type: "nominal" },
    y: { field: "revenue", type: "quantitative" },
  },
};
const lineSpec = {
  title: "Revenue over time",
  mark: { type: "line", point: true },
  encoding: {
    x: { field: "month", type: "temporal" },
    y: { field: "revenue", type: "quantitative" },
  },
};
const stackedBarSpec = {
  title: "Revenue by month and region",
  mark: "bar",
  encoding: {
    x: { field: "month", type: "nominal" },
    y: { field: "revenue", type: "quantitative", stack: "zero" },
    color: { field: "region", type: "nominal" },
  },
};

async function rejection(spec: unknown, rowsGiven: Row[] = rows): Promise<ToolError> {
  const error = await prepareChartSpec(spec, rowsGiven, options).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ToolError);
  return error as ToolError;
}

describe.skipIf(!isBrowserVendored())("prepareChartSpec (needs the vendored schema)", () => {
  it.each([
    ["bar", barSpec],
    ["line", lineSpec],
    ["stacked bar", stackedBarSpec],
  ])("accepts a valid %s spec and applies the theme", async (_name, spec) => {
    const prepared = await prepareChartSpec(spec, rows, options);
    expect(prepared.spec.config).toMatchObject({
      font: defaultTheme.fontFamily,
      range: { category: defaultTheme.palette },
    });
    expect(prepared.spec.data).toEqual({ name: "table" });
    // The model's encoding survives; polish may only add axis settings (spec-polish.ts).
    expect(prepared.spec.encoding).toMatchObject(spec.encoding);
  });

  it("names the bad property in a short error", async () => {
    const error = await rejection({
      ...barSpec,
      encoding: { ...barSpec.encoding, x: { feild: "region", type: "nominal" } },
    });
    expect(error.message).toContain('encoding.x: unknown property "feild". Did you mean "field"?');
    // Far below the 400-token result cap.
    expect(error.message.length).toBeLessThan(400);
  });

  it("lists the allowed values for a wrong enum value", async () => {
    const error = await rejection({ ...barSpec, mark: "bars" });
    expect(error.message).toContain('mark: "bars" is not allowed. Did you mean "bar"?');
    expect(error.message.length).toBeLessThan(400);
  });

  it("names a field that is not a column", async () => {
    const error = await rejection({
      ...barSpec,
      encoding: { ...barSpec.encoding, y: { field: "Revenue", type: "quantitative" } },
    });
    expect(error.message).toContain('encoding.y.field: "Revenue" is not a column');
    expect(error.message).toContain('"revenue"');
  });

  it.each([
    ["remote data", { ...barSpec, data: { url: "https://example.com/data.csv" } }, "data.url"],
    [
      "remote data in a layer",
      { layer: [{ ...barSpec, data: { url: "/etc/passwd" } }] },
      "layer[0].data.url",
    ],
    ["an image mark", { ...barSpec, mark: { type: "image" } }, "mark"],
    [
      "an image URL channel",
      { ...barSpec, encoding: { url: { field: "logo", type: "nominal" } } },
      "encoding.url",
    ],
  ])("rejects %s", async (_name, spec, location) => {
    const error = await rejection(spec);
    expect(error.message).toContain(`${location} points outside the chart`);
  });

  it("tells the model to aggregate when rows exceed the cap", async () => {
    const manyRows = Array.from({ length: 1_001 }, (_, index) => ({ region: "N", revenue: index }));
    const error = await rejection(barSpec, manyRows);
    expect(error.message).toMatch(/1001 rows; the limit is 1000\. Aggregate first with query_sql/);
  });

  it("removes the model's styling and keeps only the theme's", async () => {
    const styled = {
      ...stackedBarSpec,
      background: "black",
      padding: 40,
      config: { font: "Comic Sans MS" },
      title: { text: "Revenue", fontSize: 30, color: "red" },
      mark: { type: "bar", color: "hotpink", fontSize: 20 },
      encoding: {
        ...stackedBarSpec.encoding,
        x: {
          field: "month",
          type: "nominal",
          axis: { labelColor: "red", labelFont: "Papyrus", title: "Month" },
        },
        color: { field: "region", type: "nominal", scale: { scheme: "rainbow", range: ["#000"] } },
        stroke: { value: "red" },
      },
    };
    const prepared = await prepareChartSpec(styled, rows, options);
    const text = JSON.stringify(prepared.spec);
    for (const styling of [
      "black",
      "Comic Sans",
      "hotpink",
      "Papyrus",
      "rainbow",
      '"#000"',
      '"red"',
    ]) {
      expect(text).not.toContain(styling);
    }
    expect(prepared.spec.padding).toBeUndefined();
    expect(prepared.spec.title).toEqual({ text: "Revenue" });
    expect((prepared.spec.encoding as Record<string, unknown>).stroke).toBeUndefined();
    expect(text).toContain('"title":"Month"');
    expect(prepared.notes.join(" ")).toMatch(/Removed styling/);
  });
});
