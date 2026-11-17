// Shared setup for make_chart's format tests: a real data file, inspected, with stored rows
// traced back to it, and make_chart built on a stand-in isolate and renderer. The files it
// writes are real. Test code only.

import { dirname } from "node:path";
import {
  createFakeRenderer,
  fakeRunInIsolate,
  fakeStandardHelpers,
} from "../../../chart/test-support.ts";
import type { Row, ToolContext } from "../../../contracts/index.ts";
import { SessionDataSourceRegistry } from "../../../data/index.ts";
import {
  createSqlTestContext,
  type SqlTestContext,
} from "../../../engines/duckdb/testing/sql-test-context.ts";
import { inspectDataTool } from "../inspect/inspect-data.ts";
import { createMakeChartTool, type MakeChartDependencies } from "../make-chart.ts";

export const chartRows: Row[] = [
  { month: "2025-01-01", dept: "Sales", total: 120 },
  { month: "2025-02-01", dept: "Sales", total: 135.5 },
  { month: "2025-01-01", dept: "Ops", total: 80 },
];

const barChart = (title: string) =>
  `{ title: "${title}", mark: "bar", encoding: { x: { field: "dept", type: "nominal" }, y: { field: "total", type: "quantitative" } } }`;

export interface ChartTestKit {
  test: SqlTestContext;
  context: ToolContext;
  /** The folder of the data file, where charts are saved by default (D28). */
  folder: string;
  renderer: ReturnType<typeof createFakeRenderer>;
  /** The stored rows the chart code reads, traced back to pay.csv through their SQL. */
  handle: string;
  /** Chart code that renders "Pay by department" with a summary. */
  oneChart: string;
  /** Chart code that renders "Pay: first/half" and "Pay second", each with a summary. */
  twoCharts: string;
  tool(extra?: Partial<MakeChartDependencies>): ReturnType<typeof createMakeChartTool>;
  cleanup(): Promise<void>;
}

export async function createChartTestKit(): Promise<ChartTestKit> {
  const test = await createSqlTestContext({ dataSources: new SessionDataSourceRegistry() });
  const context = test.context;
  const dataFile = await test.writeFixture("pay.csv", "dept,total\nSales,120\nOps,80\n");
  await inspectDataTool.run({ path: dataFile }, context);
  const handle = await context.results.putRows(chartRows, {
    tool: "query_sql",
    arguments: { sql: "SELECT * FROM pay" },
  });
  const renderer = createFakeRenderer();
  return {
    test,
    context,
    folder: dirname(dataFile),
    renderer,
    handle,
    oneChart: `render(${barChart("Pay by department")}, data("${handle}"), "Sales is paid most.");`,
    twoCharts: [
      `render(${barChart("Pay: first/half")}, data("${handle}"), "First finding.");`,
      `render(${barChart("Pay second")}, data("${handle}"), "Second finding.");`,
    ].join("\n"),
    tool: (extra = {}) =>
      createMakeChartTool({
        runInIsolate: fakeRunInIsolate,
        createStandardHelpers: fakeStandardHelpers(new Map([[handle, chartRows]])),
        renderChart: renderer.renderChart,
        renderChartPages: renderer.renderChartPages,
        renderChartImage: renderer.renderChartImage,
        renderPreview: renderer.renderPreview,
        ...extra,
      }),
    cleanup: () => test.cleanup(),
  };
}
