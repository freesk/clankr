// make_chart with the real renderer: chart code to a PDF or a Word document on disk, and the PRD section 9 target
// (chart to PDF in under 5 s once the data is aggregated) measured cold and warm. The isolate is
// still the test stand-in; the real one is sandbox's and is wired in at integration.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeRunInIsolate, fakeStandardHelpers } from "../../chart/test-support.ts";
import type { ToolContext } from "../../contracts/index.ts";
import {
  type ChartRenderer,
  createChartRenderer,
  isBrowserVendored,
} from "../../engines/browser/index.ts";
import {
  pdfPageCount,
  pdfPageSize,
  pdfPageTexts,
  pdfText,
} from "../../engines/browser/test-support.ts";
import { readPackagePart, textutilText } from "../../output/testing/read-back.ts";
import { isPng, pngSize } from "../../shared/png-size.ts";
import {
  createTestToolContext,
  InMemoryResultStore,
  type TestToolContext,
} from "../../testing/index.ts";
import { createMakeChartTool } from "./make-chart.ts";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rows = months.flatMap((month) =>
  ["North", "South", "East"].map((region, index) => ({ month, region, revenue: 100 + index * 25 })),
);

const code = `render({
  title: "Revenue by month and region",
  mark: "bar",
  encoding: {
    x: { field: "month", type: "ordinal", sort: null },
    y: { field: "revenue", type: "quantitative", stack: "zero" },
    color: { field: "region", type: "nominal" }
  }
}, data("r1"));`;

describe.skipIf(!isBrowserVendored())(
  "make_chart with the real renderer (needs `npm run vendor`)",
  () => {
    let test: TestToolContext;
    let context: ToolContext;
    let renderer: ChartRenderer;

    beforeAll(async () => {
      test = await createTestToolContext();
      const results = new InMemoryResultStore();
      await results.putRows(rows, {
        tool: "query_sql",
        arguments: {
          sql: "SELECT month, region, SUM(revenue) AS revenue FROM sales GROUP BY 1, 2",
        },
      });
      context = { ...test.context, results };
      renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    });

    afterAll(async () => {
      await renderer.close();
      await test.cleanup();
    });

    function realTool() {
      return createMakeChartTool({
        runInIsolate: fakeRunInIsolate,
        createStandardHelpers: fakeStandardHelpers(new Map([["r1", rows]])),
        renderChart: renderer.renderChart,
        renderChartPages: renderer.renderChartPages,
        renderChartImage: renderer.renderChartImage,
      });
    }

    it("turns chart code into a one-page PDF, cold and warm, each under 5 s", async () => {
      const tool = realTool();
      const timings: number[] = [];
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        const output = await tool.run({ code, format: "pdf" }, context);
        timings.push(Math.round(performance.now() - started));
        expect(output.text).toContain("Saved chart:");
      }
      console.log(
        `make_chart to PDF: cold ${timings[0]} ms, warm ${timings.slice(1).join(" ms, ")} ms`,
      );

      const pdf = await readFile(join(context.workingDirectory, "revenue-by-month-and-region.pdf"));
      expect(pdfPageCount(pdf)).toBe(1);
      expect(pdfText(pdf)).toContain("Revenuebymonthandregion");
      for (const timing of timings) expect(timing).toBeLessThan(5_000);
    });

    it("turns several render calls into one portrait PDF with a summary per page", async () => {
      const tool = realTool();
      const twoCharts = `${code
        .replace("Revenue by month and region", "Two views")
        .replace('data("r1"));', 'data("r1"), "Every month, East earns the most.");')}
render({ title: "Revenue by region", mark: "bar", encoding: {
  x: { field: "region", type: "nominal" },
  y: { field: "revenue", type: "quantitative", aggregate: "sum" } } }, data("r1"),
  "East leads the year; North trails.");`;
      const output = await tool.run({ code: twoCharts, format: "pdf" }, context);
      expect(output.text).toContain("Saved 2 charts:");
      expect(output.text).toContain("2 pages, portrait, one chart per page");
      expect(output.text).toContain("Summaries: printed under each chart.");

      const pdf = await readFile(join(context.workingDirectory, "two-views.pdf"));
      const pages = pdfPageTexts(pdf);
      expect(pages).toHaveLength(2);
      expect(pages[0]).toContain("Everymonth,Eastearnsthemost.");
      expect(pages[1]).toContain("Eastleadstheyear;Northtrails.");
      const size = pdfPageSize(pdf);
      expect(size.height).toBeGreaterThan(size.width);
    });

    it("embeds the drawn chart in a Word document at print resolution", async () => {
      const summary = "Every month, East earns the most.";
      const withSummary = code
        .replace("Revenue by month and region", "Revenue for Word")
        .replace('data("r1"));', `data("r1"), "${summary}");`);
      const output = await realTool().run({ code: withSummary, format: "docx" }, context);
      const path = join(context.workingDirectory, "revenue-for-word.docx");
      expect(output.text).toContain(`Saved chart: ${path}`);

      const picture = await readPackagePart(path, "word/media/image1.png");
      expect(isPng(picture)).toBe(true);
      expect(pngSize(picture)).toEqual({ width: 2160, height: 1320 });
      // A drawn chart, not a blank canvas: a 2160 x 1320 picture of nothing compresses to a few KB.
      expect(picture.length).toBeGreaterThan(20_000);
      const text = await textutilText(path);
      expect(text).toContain("Revenue for Word");
      expect(text).toContain(summary);
    });
  },
);
