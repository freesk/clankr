// Chart pages (task 32): a summary under a single chart, and several charts in one portrait
// PDF, a page each, each with its own summary.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../../contracts/index.ts";
import { type ChartRenderer, createChartRenderer, isBrowserVendored } from "./index.ts";
import { pdfPageCount, pdfPageSize, pdfPageSizes, pdfPageTexts, pdfText } from "./test-support.ts";

const theme: Theme = {
  palette: ["#4e79a7", "#f28e2b"],
  fontFamily: "Helvetica Neue",
  page: { size: "A4", orientation: "landscape" },
};

const barSpec = {
  title: "Revenue by region",
  mark: "bar",
  encoding: {
    x: { field: "region", type: "nominal" },
    y: { field: "revenue", type: "quantitative" },
  },
};

const rows = [
  { region: "North", revenue: 120 },
  { region: "South", revenue: 80 },
  { region: "East", revenue: 95 },
];

describe.skipIf(!isBrowserVendored())("chart pages (needs `npm run vendor`)", () => {
  let renderer: ChartRenderer;
  let folder: string;

  beforeAll(async () => {
    renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    folder = await mkdtemp(join(tmpdir(), "clankr-pages-"));
  });

  afterAll(async () => {
    await renderer.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("prints a single chart's summary under it on the theme's one page", async () => {
    const outputPath = join(folder, "summary.pdf");
    const summary = "North earns the most revenue; South earns the least.";
    const result = await renderer.renderChart({
      spec: barSpec,
      rows,
      theme,
      format: "pdf",
      outputPath,
      summary,
    });
    const pdf = await readFile(outputPath);
    expect(result.pageCount).toBe(1);
    expect(pdfPageCount(pdf)).toBe(1);
    // The theme's landscape A4 is kept for one chart.
    expect(Math.round(pdfPageSize(pdf).width)).toBe(843);
    expect(pdfText(pdf)).toContain("Northearnsthemostrevenue;Southearnstheleast.");
  });

  it("prints several charts portrait, a page each, each with its own summary", async () => {
    const outputPath = join(folder, "pages.pdf");
    const facetRows = ["A", "B", "C"].flatMap((group) =>
      [2020, 2021, 2022].map((year, index) => ({ group, year, value: 10 + index })),
    );
    const facetSpec = {
      title: "Value by group",
      facet: { column: { field: "group", type: "nominal" } },
      spec: {
        mark: "line",
        encoding: {
          x: { field: "year", type: "ordinal" },
          y: { field: "value", type: "quantitative" },
        },
      },
    };
    const longSummary =
      `Line three. ${"Every group grows steadily over the years. ".repeat(9)}`.trim();
    const charts = [
      { spec: { ...barSpec, title: "Page one" }, rows, summary: "Summary one: North leads." },
      { spec: { ...barSpec, title: "Page two", mark: "point" }, rows },
      { spec: facetSpec, rows: facetRows, summary: longSummary },
    ];
    const result = await renderer.renderChartPages({
      charts,
      theme: { ...theme, footer: "Pages footer" },
      outputPath,
    });
    const pdf = await readFile(outputPath);
    expect(result.pageCount).toBe(3);
    expect(pdfPageCount(pdf)).toBe(3);
    // Portrait A4 (595 x 842 points) on every page, though the theme asks for landscape.
    for (const size of pdfPageSizes(pdf)) {
      expect(Math.round(size.width)).toBe(596);
      expect(Math.round(size.height)).toBe(843);
    }
    const pages = pdfPageTexts(pdf);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("Pageone");
    expect(pages[0]).toContain("Summaryone:Northleads.");
    expect(pages[1]).toContain("Pagetwo");
    expect(pages[1]).not.toContain("Summaryone");
    expect(pages[2]).toContain("Valuebygroup");
    expect(pages[2]).toContain(longSummary.replaceAll(/\s+/g, ""));
    for (const page of pages) expect(page).toContain("Pagesfooter");
  });

  it("prints markup in a summary as inert text", async () => {
    const before = renderer.blockedRequests.length;
    const markup = "<img src=x onerror=\"fetch('/pwned-summary')\"><b>bold</b>";
    const outputPath = join(folder, "markup-summary.pdf");
    await renderer.renderChartPages({
      charts: [
        { spec: barSpec, rows, summary: markup },
        { spec: barSpec, rows, summary: "Plain." },
      ],
      theme,
      outputPath,
    });
    expect(pdfText(await readFile(outputPath))).toContain("<b>bold</b>");
    const pwned = renderer.blockedRequests.slice(before).filter((r) => r.url.includes("pwned"));
    expect(pwned).toEqual([]);
  });

  it("names the chart Vega rejects among several", async () => {
    const hostile = {
      ...barSpec,
      transform: [{ calculate: "constructor.constructor('1')()", as: "x" }],
    };
    await expect(
      renderer.renderChartPages({
        charts: [
          { spec: barSpec, rows },
          { spec: hostile, rows },
        ],
        theme,
        outputPath: join(folder, "rejected.pdf"),
      }),
    ).rejects.toThrow(/^chart 2: /);
  });
});
