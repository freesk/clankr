import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Row } from "../../contracts/index.ts";
import { ToolError } from "../../contracts/index.ts";
import { isExcelExtensionInstalled } from "../../engines/duckdb/index.ts";
import {
  createSqlTestContext,
  generatedCsv,
  type SqlTestContext,
} from "../../engines/duckdb/testing/sql-test-context.ts";
import { querySqlTool } from "./query-sql.ts";

let test: SqlTestContext;

afterEach(async () => {
  await test?.cleanup();
});

async function setUp(limits: Partial<SqlTestContext["context"]["config"]["data"]> = {}) {
  test = await createSqlTestContext();
  Object.assign(test.context.config.data, limits);
  const salesPath = await test.writeFixture(
    "sales.csv",
    "region,amount,sold on\nnorth,10,2024-01-05\nsouth,20,2024-02-10\nnorth,5,2024-03-01\n",
  );
  test.register(salesPath, "csv", [{ sqlName: "sales", label: "sales.csv" }]);
  return salesPath;
}

async function runSql(sql: string) {
  return querySqlTool.run({ sql }, test.context);
}

async function errorOf(sql: string): Promise<string> {
  const failure = await runSql(sql).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ToolError);
  return (failure as ToolError).message;
}

async function storedRows(handle: string): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of test.results.readRows(handle)) rows.push(row);
  return rows;
}

describe("query_sql results", () => {
  it("returns columns, row count, first rows, and a handle with the SQL as provenance", async () => {
    const salesPath = await setUp();
    const sql =
      "SELECT region, sum(amount) AS total, count(*) AS n FROM sales GROUP BY region ORDER BY region";
    const output = await runSql(sql);
    expect(output.text).toContain("2 rows, 3 columns. Full result: r1.");
    expect(output.text).toContain("region | total | n");
    expect(output.text).toContain("north | 15 | 2");
    expect(output.handles).toEqual(["r1"]);
    const meta = await test.results.describe("r1");
    expect(meta.arguments).toEqual({ sql });
    expect(meta.dataSourcePaths).toEqual([salesPath]);
    // Counts stay numbers, not strings, in the stored row set.
    expect(await storedRows("r1")).toEqual([
      { region: "north", total: 15, n: 2 },
      { region: "south", total: 20, n: 1 },
    ]);
  });

  it("caps the preview and stores every row behind the handle", async () => {
    await setUp({ sqlPreviewRows: 5 });
    const output = await runSql("SELECT x FROM range(5000) t(x), (SELECT 1 FROM sales LIMIT 1)");
    expect(output.text).toContain("5,000 rows, 1 column");
    expect(output.text).toContain("(first 5 of 5,000 rows;");
    expect(output.text.split("\n").length).toBeLessThan(12);
    expect(await storedRows(output.handles?.[0] ?? "")).toHaveLength(5000);
  });

  it("stores at most the configured row limit and says so", async () => {
    await setUp({ sqlStoredRowLimit: 1000 });
    const output = await runSql("SELECT x FROM range(5000) t(x)");
    expect(output.text).toContain("Only the first 1,000 rows were stored");
    expect(await storedRows(output.handles?.[0] ?? "")).toHaveLength(1000);
  });

  it("formats dates as ISO text", async () => {
    await setUp();
    const output = await runSql('SELECT max("sold on") AS latest FROM sales');
    expect(output.text).toContain("2024-03-01");
  });
});

describe("query_sql preview", () => {
  it("shows the SQL and the data files it reads", async () => {
    const salesPath = await setUp();
    const preview = await querySqlTool.previewChange?.(
      { sql: "SELECT * FROM Sales WHERE region = 'north'" },
      test.context,
    );
    expect(preview).toMatchObject({
      summary: "Run SQL over sales.csv",
      code: "SELECT * FROM Sales WHERE region = 'north'",
      targetPaths: [],
      dataSourcePaths: [salesPath],
    });
  });

  it("does not count a string literal as a table", async () => {
    await setUp();
    const preview = await querySqlTool.previewChange?.({ sql: "SELECT 'sales'" }, test.context);
    expect(preview?.dataSourcePaths).toEqual([]);
  });
});

describe("query_sql errors", () => {
  it("lists the columns for an unknown column", async () => {
    await setUp();
    expect(await errorOf("SELECT revenue FROM sales")).toBe(
      'Column "revenue" does not exist. Columns: region, amount, sold on. Quote names that contain spaces with double quotes.',
    );
  });

  it("lists the tables for an unknown table", async () => {
    await setUp();
    expect(await errorOf("SELECT * FROM orders")).toMatch(
      /^Table "orders" does not exist. Tables: sales\./,
    );
  });

  it("reports a syntax error without paths", async () => {
    await setUp();
    const message = await errorOf("SELEC * FROM sales");
    expect(message).toMatch(/^Parser error: syntax error/);
    expect(message).not.toContain("/");
  });

  it("asks for inspection when nothing is registered", async () => {
    test = await createSqlTestContext();
    expect(await errorOf("SELECT 1")).toMatch(/Run inspect_data/);
  });
});

describe("query_sql limits", () => {
  it("interrupts a query that runs too long", async () => {
    await setUp({ sqlTimeoutMs: 300 });
    const started = Date.now();
    const message = await errorOf("SELECT count(*) FROM range(100000000000) t(x) WHERE x % 7 = 3");
    expect(message).toMatch(/ran longer than 0.3 s and was stopped/);
    expect(Date.now() - started).toBeLessThan(3000);
    // The connection is still usable afterwards.
    expect((await runSql("SELECT count(*) AS n FROM sales")).text).toContain("3");
  });

  it("stops when the tool call is cancelled", async () => {
    await setUp();
    const controller = new AbortController();
    test.context = { ...test.context, signal: controller.signal };
    setTimeout(() => controller.abort(), 200);
    expect(await errorOf("SELECT count(*) FROM range(100000000000) t(x) WHERE x % 7 = 3")).toBe(
      "The query was cancelled.",
    );
  });

  it("fails cleanly when a query needs too much memory", async () => {
    await setUp({ sqlMemoryLimitMb: 64 });
    const message = await errorOf(
      "SELECT length(string_agg(repeat('z', 100), ',')) FROM range(3000000)",
    );
    expect(message).toMatch(/needed more than 64 MB of memory/);
    expect((await runSql("SELECT 6 * 7 AS answer")).text).toContain("42");
  });

  it("spills into the session scratch folder", async () => {
    await setUp();
    const output = await runSql("SELECT current_setting('temp_directory') AS spill");
    expect(await storedRows(output.handles?.[0] ?? "")).toEqual([
      { spill: test.context.vixPaths.session.scratch },
    ]);
  });

  it("writes spill files there when a query outgrows memory", async () => {
    await setUp({ sqlMemoryLimitMb: 200 });
    const seen = new Set<string>();
    const watcher = setInterval(async () => {
      for (const name of await readdir(test.context.vixPaths.session.scratch)) seen.add(name);
    }, 2);
    try {
      const output = await runSql(
        "SELECT count(*) AS groups FROM (SELECT x % 10000000 AS g, count(*) FROM range(20000000) t(x) GROUP BY g)",
      );
      expect(output.text).toContain("10000000");
    } finally {
      clearInterval(watcher);
    }
    expect(seen.size).toBeGreaterThan(0);
  }, 30_000);
});

describe("query_sql registration", () => {
  it("rebuilds the engine when a file is registered after the first query (D38)", async () => {
    await setUp();
    await runSql("SELECT count(*) FROM sales");
    const targetsPath = await test.writeFixture("targets.tsv", "region\ttarget\nnorth\t12\n");
    test.register(targetsPath, "tsv", [{ sqlName: "targets", label: "targets.tsv" }]);
    const output = await runSql(
      "SELECT s.region, sum(amount) AS total, max(target) AS target FROM sales s JOIN targets t USING (region) GROUP BY s.region",
    );
    expect(output.text).toContain("north | 15 | 12");
  });

  it("reads a table stored as a row set, file by file", async () => {
    await setUp();
    const handle = await test.results.putRows(
      [
        { item: "pens", cost: 3 },
        { item: "paper", cost: 7 },
      ],
      { tool: "inspect_data", arguments: {} },
    );
    test.register(join(test.dataDirectory, "report.docx"), "docx", [
      { sqlName: "report_table_1", label: "Table 1", rowsHandle: handle },
    ]);
    expect((await runSql("SELECT sum(cost) AS total FROM report_table_1")).text).toContain("10");
  });

  it.skipIf(!isExcelExtensionInstalled())(
    "reads an .xlsx sheet through the vendored reader (needs npm run vendor)",
    async () => {
      await setUp();
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Budget 2025"],
        [],
        ["team", "budget"],
        ["ops", 100],
        ["eng", 250],
      ]);
      XLSX.utils.book_append_sheet(workbook, sheet, "Plan");
      const path = join(test.dataDirectory, "budget.xlsx");
      await writeFile(path, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
      test.register(path, "xlsx", [
        {
          sqlName: "budget",
          label: "Plan",
          layout: { headerRow: 3, sheet: "Plan", cellRange: "A3:B5" },
        },
      ]);
      expect((await runSql("SELECT sum(budget) AS total FROM budget")).text).toContain("350");
    },
  );
});

describe("query_sql performance (PRD section 9)", () => {
  it("groups 1,000,000 rows in under 5 s", async () => {
    await setUp();
    const path = join(test.dataDirectory, "million.csv");
    await writeFile(path, generatedCsv(1_000_000));
    test.register(path, "csv", [{ sqlName: "million", label: "million.csv" }]);
    const started = performance.now();
    const output = await runSql(
      "SELECT department, count(*) AS n, sum(amount) AS total FROM million GROUP BY department ORDER BY department",
    );
    const elapsedMs = performance.now() - started;
    console.log(`query_sql group-by over 1,000,000 CSV rows: ${elapsedMs.toFixed(0)} ms`);
    expect(output.text).toContain("50 rows, 3 columns");
    expect(output.text).toContain("dept_0 | 20000 |");
    expect(elapsedMs).toBeLessThan(5000);
  }, 30_000);
});
