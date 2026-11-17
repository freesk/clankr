import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTheme, type SelfCheckVerdict } from "../../chart/index.ts";
import {
  createFakeRenderer,
  fakeRunInIsolate,
  fakeStandardHelpers,
} from "../../chart/test-support.ts";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { isBrowserVendored } from "../../engines/browser/index.ts";
import {
  createTestToolContext,
  InMemoryDataSourceRegistry,
  InMemoryResultStore,
  type TestToolContext,
} from "../../testing/index.ts";
import { createMakeChartTool, type MakeChartDependencies } from "./make-chart.ts";

const rows = [
  { dept: "Sales", total: 120 },
  { dept: "Ops", total: 80 },
];
const sql = "SELECT dept, SUM(pay) AS total FROM payroll_sheet1 GROUP BY dept";
const chartCode = `const spec = {
  title: "Pay by department",
  mark: { type: "bar", color: "red" },
  encoding: { x: { field: "dept", type: "nominal" }, y: { field: "total", type: "quantitative" } }
};
render(spec, data("r1"));`;

describe.skipIf(!isBrowserVendored())("make_chart (needs the vendored schema)", () => {
  let test: TestToolContext;
  let context: ToolContext;
  let dataFile: string;
  let renderer: ReturnType<typeof createFakeRenderer>;

  beforeEach(async () => {
    test = await createTestToolContext();
    dataFile = join(test.context.workingDirectory, "data", "payroll.xlsx");
    const results = new InMemoryResultStore();
    await results.putRows(rows, { tool: "query_sql", arguments: { sql } });
    const dataSources = new InMemoryDataSourceRegistry([
      {
        handle: "p1",
        realPath: dataFile,
        format: "xlsx",
        tables: [{ sqlName: "payroll_sheet1", label: "Sheet1" }],
      },
    ]);
    // As after `--format pdf`: these tests are about charts, not about choosing a format.
    context = { ...test.context, results, dataSources, outputFormat: { sessionFormat: "pdf" } };
    renderer = createFakeRenderer();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  function tool(extra: Partial<MakeChartDependencies> = {}) {
    return createMakeChartTool({
      runInIsolate: fakeRunInIsolate,
      createStandardHelpers: fakeStandardHelpers(new Map([["r1", rows]])),
      renderChart: renderer.renderChart,
      renderChartPages: renderer.renderChartPages,
      renderChartImage: renderer.renderChartImage,
      renderPreview: renderer.renderPreview,
      ...extra,
    });
  }

  const barChart = (title: string) =>
    `{ title: "${title}", mark: "bar", encoding: { x: { field: "dept", type: "nominal" }, y: { field: "total", type: "quantitative" } } }`;

  describe("summaries and several charts", () => {
    it("passes a single chart's summary to the renderer and says it is printed", async () => {
      const code = `render(${barChart("Pay")}, data("r1"), "Sales is paid most.");`;
      const output = await tool().run({ code }, context);
      expect(renderer.requests[0]?.summary).toBe("Sales is paid most.");
      expect(output.text).toContain("(11 B, 1 page)");
      expect(output.text).toContain("Summary: printed under the chart.");
    });

    it("saves a chart without a summary and tells the model it is missing", async () => {
      const output = await tool().run({ code: chartCode }, context);
      expect(renderer.requests[0]?.summary).toBeUndefined();
      expect(output.text).toMatch(/No summary for the chart\. Pass one as render's third argument/);
    });

    it("puts several charts in one PDF with numbered spec files", async () => {
      const code = [
        `render(${barChart("Pay one")}, data("r1"), "First finding.");`,
        `render(${barChart("Pay two")}, data("r1"));`,
        `render(${barChart("Pay three")}, data("r1"), "Third finding.");`,
      ].join("\n");
      const output = await tool().run({ code }, context);
      const folder = join(dataFile, "..");

      expect(renderer.requests).toEqual([]);
      const request = renderer.pageRequests[0];
      expect(request?.outputPath).toBe(join(folder, "pay-one.pdf"));
      expect(request?.charts.map((chart) => chart.summary)).toEqual([
        "First finding.",
        undefined,
        "Third finding.",
      ]);
      for (const [index, chart] of (request?.charts ?? []).entries()) {
        const saved = await readFile(join(folder, `pay-one.${index + 1}.vl.json`), "utf8");
        expect(JSON.parse(saved)).toEqual(chart.spec);
      }
      expect(output.text).toContain(
        `Saved 3 charts: ${join(folder, "pay-one.pdf")} (11 B, 3 pages, portrait, one chart per page)`,
      );
      expect(output.text).toContain("pay-one.1.vl.json, pay-one.2.vl.json, pay-one.3.vl.json");
      expect(output.text).toContain("No summary for chart 2.");
    });

    it("names the chart whose spec is invalid", async () => {
      const code = `render(${barChart("Fine")}, data("r1"), "Ok.");
render({ mark: "bars", encoding: { x: { field: "dept", type: "nominal" } } }, data("r1"));`;
      await expect(tool().run({ code }, context)).rejects.toThrow(
        /^chart 2: The Vega-Lite spec is invalid/,
      );
      expect(renderer.pageRequests).toEqual([]);
    });

    it("refuses several charts as PNG, pointing at the formats that hold several", async () => {
      const code = `render(${barChart("A")}, data("r1")); render(${barChart("B")}, data("r1"));`;
      await expect(tool().run({ code, format: "png" }, context)).rejects.toThrow(
        /PNG holds one chart, and the code rendered 2\..*one make_chart call per PNG chart.*pdf, docx, xlsx/,
      );
    });

    it("checks each chart and names the one that fails, then retries once per call", async () => {
      const verdicts: SelfCheckVerdict[] = [
        { passed: true, verdict: "Clear." },
        { passed: false, verdict: "Labels overlap." },
      ];
      const seen: string[] = [];
      const selfCheck = async (_png: Buffer, title: string) => {
        seen.push(title);
        return verdicts.shift() ?? { passed: true, verdict: "Clear." };
      };
      const chartTool = tool({ selfCheck });
      const code = `render(${barChart("A")}, data("r1"), "a."); render(${barChart("B")}, data("r1"), "b.");`;

      const first = await chartTool.run({ code }, context);
      expect(seen).toEqual(["A", "B"]);
      expect(first.text).toContain("Self-check failed: chart 2: Labels overlap.");
      expect(renderer.pageRequests).toHaveLength(0);

      const second = await chartTool.run({ code }, context);
      expect(second.text).toContain("Self-check passed: all 2 charts.");
      expect(renderer.pageRequests).toHaveLength(1);
    });
  });

  it("saves the chart beside the data file with its code, spec, and SQL", async () => {
    const output = await tool().run({ code: chartCode }, context);
    const folder = join(dataFile, "..");
    const chartPath = join(folder, "pay-by-department.pdf");
    expect(output.text).toContain(`Saved chart: ${chartPath}`);

    const request = renderer.requests[0];
    expect(request?.format).toBe("pdf");
    expect(request?.rows).toEqual(rows);
    expect(request?.theme).toEqual(defaultTheme);
    expect(JSON.stringify(request?.spec)).not.toContain("red");

    expect(await readFile(join(folder, "pay-by-department.chart.js"), "utf8")).toContain(
      "render(spec",
    );
    const savedSpec = JSON.parse(await readFile(join(folder, "pay-by-department.vl.json"), "utf8"));
    expect(savedSpec).toEqual(request?.spec);
    const savedSql = await readFile(join(folder, "pay-by-department.sql"), "utf8");
    expect(savedSql).toContain(sql);
    expect(savedSql).toContain(`-- Data file: ${dataFile}`);
    expect(output.text).toContain("Removed styling");
  });

  it("gives a second chart with the same title a numbered name", async () => {
    const chartTool = tool();
    await chartTool.run({ code: chartCode }, context);
    const second = await chartTool.run({ code: chartCode }, context);
    expect(second.text).toContain(join(dataFile, "..", "pay-by-department-2.pdf"));
  });

  it("uses an explicit output path and takes the format from its extension", async () => {
    const output = await tool().run({ code: chartCode, output_path: "charts/pay.png" }, context);
    expect(output.text).toContain(join(context.workingDirectory, "charts", "pay.png"));
    expect(renderer.requests[0]?.format).toBe("png");
  });

  it("previews the code, the target folder, and the data file", async () => {
    const preview = await tool().previewChange?.({ code: chartCode }, context);
    expect(preview).toEqual({
      summary: `Run chart code and save a PDF chart in ${join(dataFile, "..")}`,
      code: chartCode,
      targetPaths: [join(dataFile, "..")],
      dataSourcePaths: [dataFile],
    });
  });

  it("returns a fixable error for an invalid spec and writes nothing", async () => {
    const code = `render({ mark: "bars", encoding: { x: { field: "dept", type: "nominal" } } }, data("r1"))`;
    await expect(tool().run({ code }, context)).rejects.toThrow(/mark: "bars" is not allowed/);
    expect(renderer.requests).toEqual([]);
  });

  it("says when the code never called render", async () => {
    const error = await tool()
      .run({ code: `const rows = data("r1"); console.log(rows.length);` }, context)
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as Error).message).toMatch(/without calling render[\s\S]*Console output:\n2/);
  });

  it("refuses rows over the cap with the aggregate-first message", async () => {
    context.config.data.rowCap = 1;
    await expect(tool().run({ code: chartCode }, context)).rejects.toThrow(
      /Aggregate first with query_sql/,
    );
  });

  describe("self-check (DATA-18, D29)", () => {
    function scriptedCheck(verdicts: SelfCheckVerdict[]) {
      const seen: string[] = [];
      const selfCheck = async (_png: Buffer, title: string) => {
        seen.push(title);
        return verdicts.shift();
      };
      return { selfCheck, seen };
    }

    it("writes the chart when the check passes", async () => {
      const { selfCheck, seen } = scriptedCheck([{ passed: true, verdict: "Clear." }]);
      const output = await tool({ selfCheck }).run({ code: chartCode }, context);
      expect(seen).toEqual(["Pay by department"]);
      expect(renderer.previews).toHaveLength(1);
      expect(output.text).toContain("Self-check passed: Clear.");
    });

    it("retries exactly once: a second failure is written and reported", async () => {
      const { selfCheck } = scriptedCheck([
        { passed: false, verdict: "Labels overlap." },
        { passed: false, verdict: "Still crowded." },
        { passed: false, verdict: "Third chart, new request." },
      ]);
      const chartTool = tool({ selfCheck });

      const first = await chartTool.run({ code: chartCode }, context);
      expect(first.text).toContain("Self-check failed: Labels overlap.");
      expect(first.text).toContain("Nothing was saved");
      expect(renderer.requests).toHaveLength(0);

      const second = await chartTool.run({ code: chartCode }, context);
      expect(second.text).toContain("Saved chart:");
      expect(second.text).toContain("Self-check failed: Still crowded.");
      expect(renderer.requests).toHaveLength(1);

      // The retry is spent; a new chart request gets its own retry again.
      const third = await chartTool.run({ code: chartCode }, context);
      expect(third.text).toContain("Nothing was saved");
    });
  });
});
