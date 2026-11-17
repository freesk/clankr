import { afterEach, describe, expect, it } from "vitest";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import {
  createTestToolContext,
  InMemoryDataSourceRegistry,
  type InMemoryResultStore,
} from "../../testing/index.ts";
import { handlesReadBy, runJsTool } from "./run-js.ts";

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

async function makeContext(overrides: Partial<ToolContext> = {}) {
  const { context, cleanup } = await createTestToolContext(overrides);
  cleanups.push(cleanup);
  context.config.data.isolateTimeoutMs = 1_000;
  return { context, results: context.results as InMemoryResultStore };
}

async function runJs(code: string, context: ToolContext) {
  return await runJsTool.run(runJsTool.parameters.parse({ code }), context);
}

describe("run_js definition", () => {
  it("is an execute-class data tool", () => {
    expect(runJsTool).toMatchObject({ name: "run_js", permission: "execute", groups: ["data"] });
  });
});

describe("run_js results", () => {
  it("returns a scalar as JSON and a string as is", async () => {
    const { context } = await makeContext();
    expect(await runJs("({ total: 3 })", context)).toEqual({ text: '{"total":3}', handles: [] });
    expect(await runJs('"plain text"', context)).toEqual({ text: "plain text", handles: [] });
  });

  it("stores returned rows and shows the first rows with the handle", async () => {
    const { context, results } = await makeContext();
    const output = await runJs(
      "Array.from({ length: 30 }, (_, i) => ({ i, even: i % 2 === 0 }))",
      context,
    );
    expect(output.handles).toEqual(["r1"]);
    const lines = output.text.split("\n");
    expect(lines[0]).toBe("Returned 30 rows as r1. Columns: i, even.");
    expect(lines[1]).toBe("First 20 rows:");
    expect(lines).toHaveLength(22);
    expect(await results.describe("r1")).toMatchObject({ tool: "run_js", itemCount: 30 });
  });

  it("tells the model when nothing was returned", async () => {
    const { context } = await makeContext();
    const output = await runJs("const x = 1;", context);
    expect(output.text).toMatch(/^The code returned no value/);
  });

  it("lists saved handles and console output", async () => {
    const { context } = await makeContext();
    const output = await runJs(
      'console.log("saving");\nsave("t", [{ a: 1 }]);\nreturn "done";',
      context,
    );
    expect(output).toEqual({ text: "done\n\nSaved: r1\n\nConsole:\nsaving", handles: ["r1"] });
  });

  it("throws a short ToolError with the line and recent console output", async () => {
    const { context } = await makeContext();
    const failure = runJs('console.log("step 1");\nnull.x;', context);
    await expect(failure).rejects.toBeInstanceOf(ToolError);
    await expect(failure).rejects.toThrow(
      "TypeError: Cannot read properties of null (reading 'x') (line 2)\nConsole before the error:\nstep 1",
    );
  });

  it("refuses to store more returned rows than the cap", async () => {
    const { context } = await makeContext();
    context.config.data.rowCap = 5;
    await expect(runJs("Array.from({ length: 6 }, (_, i) => ({ i }))", context)).rejects.toThrow(
      /returned 6 rows; at most 5/,
    );
  });

  it("uses the configured limits", async () => {
    const { context } = await makeContext();
    context.config.data.isolateTimeoutMs = 200;
    await expect(runJs("while (true) {}", context)).rejects.toThrow(/longer than 0.2 s/);
  });
});

describe("run_js previewChange", () => {
  it("shows the code and the handles it reads", async () => {
    const { context } = await makeContext();
    const code = 'data("r4").filter((row) => row.total > 0)';
    const preview = await runJsTool.previewChange?.({ code }, context);
    expect(preview).toEqual({
      summary: "Run JavaScript in the sandbox reading r4",
      code,
      targetPaths: [],
    });
  });

  it("traces handles to data files through the registry and provenance", async () => {
    const dataSources = new InMemoryDataSourceRegistry([
      {
        handle: "r1",
        realPath: "/data/payroll.xlsx",
        format: "xlsx",
        tables: [{ sqlName: "payroll_sheet1", label: "Sheet1" }],
      },
      {
        handle: "r2",
        realPath: "/data/report.docx",
        format: "docx",
        tables: [{ sqlName: "report_table1", label: "Table 1", rowsHandle: "r3" }],
      },
    ]);
    const { context, results } = await makeContext({ dataSources });
    for (let index = 0; index < 3; index++)
      await results.putText("filler", { tool: "x", arguments: {} });
    const sqlHandle = await results.putRows([{ n: 1 }], {
      tool: "query_sql",
      arguments: { sql: "SELECT dept, count(*) AS n FROM PAYROLL_SHEET1 GROUP BY dept" },
    });
    const earlierJsHandle = await results.putRows([{ n: 1 }], {
      tool: "run_js",
      arguments: { code: `data("${sqlHandle}")` },
    });

    const preview = await runJsTool.previewChange?.(
      { code: `[data("${earlierJsHandle}"), data('r3'), data("r99")]` },
      context,
    );
    expect(preview?.dataSourcePaths?.sort()).toEqual(["/data/payroll.xlsx", "/data/report.docx"]);
  });
});

describe("handlesReadBy", () => {
  it("finds string-literal handles passed to data()", () => {
    expect(
      handlesReadBy('data(\'r1\'); data( "r2" ); data(`r1`); data(name); mydata("r9")'),
    ).toEqual(["r1", "r2"]);
  });
});
