// make_chart with the real renderer: chart code to a PDF on disk, and the PRD section 9 target
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
import { pdfPageCount, pdfText } from "../../engines/browser/test-support.ts";
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

    it("turns chart code into a one-page PDF, cold and warm, each under 5 s", async () => {
      const tool = createMakeChartTool({
        runInIsolate: fakeRunInIsolate,
        createStandardHelpers: fakeStandardHelpers(new Map([["r1", rows]])),
        renderChart: renderer.renderChart,
      });
      const timings: number[] = [];
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        const output = await tool.run({ code }, context);
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
  },
);
