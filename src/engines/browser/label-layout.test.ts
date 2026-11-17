// Vega-Lite draws text labels for close values on top of each other; the render page pushes
// them apart. Checked in a real render, with synthetic data.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultTheme } from "../../chart/index.ts";
import { type ChartRenderer, createChartRenderer, isBrowserVendored } from "./index.ts";

const rows = [
  { place: "First", year: 2025, value: 146 },
  { place: "Second", year: 2025, value: 138 },
];

const spec = {
  title: "End labels",
  mark: { type: "text", align: "left" },
  encoding: {
    x: { field: "year", type: "quantitative" },
    y: { field: "value", type: "quantitative", scale: { domain: [0, 800] } },
    text: { field: "place" },
  },
};

/** The y of each text element whose content is one of the labels. */
function labelYs(svg: string): number[] {
  return [
    ...svg.matchAll(/<text[^>]*transform="translate\(([\d.-]+),([\d.-]+)\)"[^>]*>(First|Second)</g),
  ].map((match) => Number(match[2]));
}

describe.skipIf(!isBrowserVendored())("label layout (needs `npm run vendor`)", () => {
  let renderer: ChartRenderer;
  let folder: string;

  beforeAll(async () => {
    renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    folder = await mkdtemp(join(tmpdir(), "clankr-labels-"));
  });

  afterAll(async () => {
    await renderer.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("pushes overlapping labels apart so each has its own line", async () => {
    const outputPath = join(folder, "labels.svg");
    await renderer.renderChart({ spec, rows, theme: defaultTheme, format: "svg", outputPath });
    const ys = labelYs(await readFile(outputPath, "utf8"));
    expect(ys).toHaveLength(2);
    expect(Math.abs((ys[0] ?? 0) - (ys[1] ?? 0))).toBeGreaterThanOrEqual(11);
  });
});
