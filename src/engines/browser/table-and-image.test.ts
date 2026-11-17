// The two things the office formats ask of the browser: a row set printed as a paginated PDF
// table (export_table), and a chart as a print-resolution PNG for a Word document.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TableRenderRequest, Theme } from "../../contracts/index.ts";
import { isPng } from "../../shared/png-size.ts";
import { type ChartRenderer, createChartRenderer, isBrowserVendored } from "./index.ts";
import { pdfPageCount, pdfPageSizes, pdfPageTexts, pdfText, pngSize } from "./test-support.ts";

const theme: Theme = {
  palette: ["#4e79a7", "#f28e2b"],
  fontFamily: "Helvetica Neue",
  page: { size: "A4", orientation: "portrait" },
};

function tableRequest(rowCount: number, outputPath: string): TableRenderRequest {
  return {
    title: "Orders by region",
    columns: ["Order", "Region", "Amount"],
    cells: Array.from({ length: rowCount }, (_, index) => [
      `order-${index + 1}`,
      index % 2 === 0 ? "North" : "South",
      String(100 + index),
    ]),
    numericColumns: [false, false, true],
    theme,
    outputPath,
  };
}

describe.skipIf(!isBrowserVendored())("tables and print images (needs `npm run vendor`)", () => {
  let renderer: ChartRenderer;
  let folder: string;

  beforeAll(async () => {
    renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    folder = await mkdtemp(join(tmpdir(), "clankr-table-"));
  });

  afterAll(async () => {
    await renderer.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("prints a short table on one page with its title and every cell", async () => {
    const outputPath = join(folder, "short.pdf");
    const result = await renderer.renderTable(tableRequest(3, outputPath));
    const pdf = await readFile(outputPath);
    expect(result).toMatchObject({ path: outputPath, sizeBytes: pdf.length, pageCount: 1 });
    const text = pdfText(pdf);
    for (const expected of ["Ordersbyregion", "Order", "Region", "Amount", "order-3", "102"]) {
      expect(text).toContain(expected);
    }
  });

  it("paginates a long table on the theme's page and repeats the header row", async () => {
    const outputPath = join(folder, "long.pdf");
    const result = await renderer.renderTable(tableRequest(400, outputPath));
    const pdf = await readFile(outputPath);
    const pageCount = pdfPageCount(pdf);
    expect(pageCount).toBeGreaterThan(2);
    expect(result.pageCount).toBe(pageCount);
    // A4 portrait, in points, on every page.
    for (const size of pdfPageSizes(pdf)) {
      expect(Math.round(size.width)).toBe(596);
      expect(Math.round(size.height)).toBe(843);
    }
    const pages = pdfPageTexts(pdf);
    for (const page of pages) expect(page).toContain("OrderRegionAmount");
    expect(pages[0]).toContain("order-1North100");
    expect(pages.at(-1)).toContain("order-400South499");
    // The title is printed once, above the table.
    expect(pdfText(pdf).match(/Ordersbyregion/g)).toHaveLength(1);
  });

  it("prints markup in a cell as characters and fetches nothing for it", async () => {
    const outputPath = join(folder, "markup.pdf");
    const request = tableRequest(1, outputPath);
    request.cells = [['<img src="https://example.com/x.png">', "<b>bold</b>", "1"]];
    const blockedBefore = renderer.blockedRequests.length;
    await renderer.renderTable(request);
    const text = pdfText(await readFile(outputPath));
    expect(text).toContain("<b>bold</b>");
    expect(text).toContain('<imgsrc="https://example.com/x.png">');
    expect(renderer.blockedRequests.length).toBe(blockedBefore);
  });

  it("never overwrites an existing file", async () => {
    const outputPath = join(folder, "short.pdf");
    await expect(renderer.renderTable(tableRequest(1, outputPath))).rejects.toThrow(/EEXIST/);
  });

  it("draws a chart as a PNG at print resolution without writing a file", async () => {
    const spec = {
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
    ];
    const image = await renderer.renderChartImage(spec, rows, theme);
    expect(isPng(image.png)).toBe(true);
    // 720 x 440 CSS pixels at three device pixels each: about 300 dpi across a page.
    expect(pngSize(image.png)).toEqual({ width: 2160, height: 1320 });
    expect(image.notes).toEqual([]);
  });
});
