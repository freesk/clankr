import { describe, expect, it } from "vitest";
import { ToolError } from "../contracts/index.ts";
import { InMemoryResultStore } from "../testing/index.ts";
import { createRenderCapture, maxChartsPerCall } from "./chart-code.ts";
import { maxSummaryCharacters, normaliseSummary } from "./chart-summary.ts";

const rows = [{ region: "North", revenue: 1 }];
const spec = { mark: "bar" };

describe("normaliseSummary", () => {
  it("allows a missing or blank summary", () => {
    expect(normaliseSummary(undefined)).toEqual({});
    expect(normaliseSummary(null)).toEqual({});
    expect(normaliseSummary("  \n ")).toEqual({});
  });

  it("collapses whitespace and control characters, keeping markup as plain text", () => {
    const tidied = normaliseSummary("North\u0007 leads.\n\n  <b>South</b>   lags.");
    expect(tidied).toEqual({ summary: "North leads. <b>South</b> lags." });
  });

  it("cuts a long summary to the cap, with a note", () => {
    const tidied = normaliseSummary("word ".repeat(200));
    expect(tidied.summary?.length).toBeLessThanOrEqual(maxSummaryCharacters);
    expect(tidied.summary?.endsWith("…")).toBe(true);
    expect(tidied.note).toMatch(/cut to 400 characters/);
  });

  it("refuses a summary that is not text", () => {
    expect(() => normaliseSummary(42)).toThrow(ToolError);
    expect(() => normaliseSummary(42)).toThrow(/summary must be text/);
  });
});

describe("render capture", () => {
  function capture() {
    return createRenderCapture(new InMemoryResultStore(), 1_000);
  }

  it("records each render call as a chart, with its summary", async () => {
    const { render, charts, notes } = capture();
    await render(spec, rows, "North leads.");
    await render({ mark: "line" }, rows);
    await render({ mark: "point" }, rows, "x".repeat(500));
    expect(charts().map((chart) => chart.summary?.slice(0, 12))).toEqual([
      "North leads.",
      undefined,
      "xxxxxxxxxxxx",
    ]);
    expect(notes()).toEqual([expect.stringMatching(/^Chart 3: A summary was cut/)]);
  });

  it(`refuses more than ${maxChartsPerCall} charts in one call`, async () => {
    const { render, charts } = capture();
    for (let index = 0; index < maxChartsPerCall; index++) await render(spec, rows);
    await expect(render(spec, rows)).rejects.toThrow(
      /more than 6 times.*put the rest in another make_chart call/,
    );
    expect(charts()).toHaveLength(maxChartsPerCall);
  });

  it("names the chart in an argument error once there is more than one", async () => {
    const { render } = capture();
    await expect(render("bar", rows)).rejects.toThrow(/^render\(spec, rows, summary\): spec/);
    await render(spec, rows);
    await expect(render(spec, "not-a-handle")).rejects.toThrow(/^chart 2: render\(spec, rows\)/);
    await expect(render(spec, rows, 7)).rejects.toThrow(/^chart 2: .*summary must be text/);
  });
});
