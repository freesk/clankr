import { copyFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError } from "../../../contracts/index.ts";
import { SessionDataSourceRegistry } from "../../../data/index.ts";
import { isExcelExtensionInstalled } from "../../../engines/duckdb/index.ts";
import {
  createSqlTestContext,
  type SqlTestContext,
} from "../../../engines/duckdb/testing/sql-test-context.ts";
import { FixedPathPolicy } from "../../../testing/index.ts";
import { querySqlTool } from "../query-sql.ts";
import { inspectDataTool } from "./inspect-data.ts";
import { docxParagraph, docxTable, writeDocx, writeWorkbook } from "./testing/fixtures.ts";

let test: SqlTestContext;
const needsExcel = !isExcelExtensionInstalled();

afterEach(async () => {
  await test?.cleanup();
});

async function setUp(): Promise<SqlTestContext> {
  test = await createSqlTestContext({ dataSources: new SessionDataSourceRegistry() });
  return test;
}

async function inspect(path: string, extra: { sheet?: string; header_row?: number } = {}) {
  return inspectDataTool.run({ path, ...extra }, test.context);
}

async function sql(text: string): Promise<string> {
  return (await querySqlTool.run({ sql: text }, test.context)).text;
}

const payrollRows: unknown[][] = [
  ["Quarterly payroll report"],
  ["Prepared by finance"],
  [],
  ["Employee", "Department", "Salary", "Start date", "Active"],
  ["Ann", "ops", 1000, new Date(2024, 0, 15), true],
  ["Bob", "eng", 2000.5, new Date(2023, 5, 1), false],
  ["Cid", "eng", "n/a", new Date(2022, 11, 31), true],
  ["Dee", null, 1500, null, true],
];

describe("inspect_data on delimited files", () => {
  it("profiles a CSV and registers it for SQL", async () => {
    await setUp();
    const path = await test.writeFixture(
      "sales.csv",
      "region,amount,sold_on,note\nnorth,10,2024-01-05,ok\nsouth,20,2024-02-10,\nnorth,5,2024-03-01,x\n",
    );
    const output = await inspect(path);
    expect(output.text).toContain("sales.csv: csv");
    expect(output.text).toContain(
      "Table sales (comma-separated): 3 rows x 4 columns, header row 1",
    );
    expect(output.text).toContain("region | text | 0 | 2 | north | south |");
    expect(output.text).toContain("amount | number | 0 | 3 | 5 | 20 |");
    expect(output.text).toContain("sold_on | date | 0 | 3 | 2024-01-05 | 2024-03-01 |");
    expect(output.text).toContain("note | text | 1 | 2 |");
    const source = test.registry.find(path);
    expect(source?.tables.map((table) => table.sqlName)).toEqual(["sales"]);
    expect(source?.handle).toBe(output.handles?.[0]);
    expect(test.registry.findByTable("sales")?.realPath).toBe(path);
    expect(await sql("SELECT sum(amount) AS total FROM sales")).toContain("35");
  });

  it("detects a TSV and a header below a title block", async () => {
    await setUp();
    const path = await test.writeFixture(
      "targets.tsv",
      "Targets for 2025\n\nregion\ttarget\tmanager\nnorth\t12\tAnn\nsouth\t30\tBob\n",
    );
    const output = await inspect(path);
    expect(output.text).toContain(
      "Table targets (tab-separated): 2 rows x 3 columns, header row 3",
    );
    expect(await sql("SELECT max(target) AS best FROM targets")).toContain("30");
  });

  it("reports a column of numbers and text as mixed", async () => {
    await setUp();
    const path = await test.writeFixture("scores.csv", "name,score\na,1\nb,2\nc,absent\nd,4\n");
    expect((await inspect(path)).text).toContain("score | mixed (1 of 4 values are not numbers");
  });

  it("accepts a header row override", async () => {
    await setUp();
    const path = await test.writeFixture("raw.csv", "1,2\nx,y\n3,4\n");
    const output = await inspect(path, { header_row: 2 });
    expect(output.text).toContain("header row 2");
    expect(output.text).toMatch(/\nx \| number/);
  });

  it("shows the first columns of a wide sheet and keeps the rest in the stored profile", async () => {
    await setUp();
    const header = Array.from({ length: 60 }, (_, index) => `c${index + 1}`).join(",");
    const values = Array.from({ length: 60 }, (_, index) => index).join(",");
    const path = await test.writeFixture("wide.csv", `${header}\n${values}\n`);
    const output = await inspect(path);
    const profileHandle = output.handles?.[0] ?? "";
    expect(output.text).toContain(
      `(20 more columns not shown. Read ${profileHandle} with read_result`,
    );
    expect(output.text).not.toContain("\nc41 |");
    const stored = await test.results.readText(profileHandle, { startLine: 1, lineCount: 200 });
    expect(stored).toContain("\nc60 |");
  });

  it("masks the values of columns marked sensitive (DATA-5)", async () => {
    await setUp();
    test.context.config.data.sensitiveColumns = ["Salary"];
    const path = await test.writeFixture("pay.csv", "name,salary\nann,1000\nbob,2000\n");
    const output = await inspect(path);
    expect(output.text).toContain("salary | number | 0 | 2 | (masked) | (masked) | (masked)");
    expect(output.text).toContain("name | text | 0 | 2 | ann | bob |");
  });
});

describe.skipIf(needsExcel)("inspect_data on .xlsx (needs npm run vendor)", () => {
  it("finds the header under a title block and profiles every sheet", async () => {
    await setUp();
    const path = join(test.dataDirectory, "payroll.xlsx");
    await writeWorkbook(
      path,
      [
        { name: "Payroll", rows: payrollRows },
        {
          name: "Teams",
          rows: [
            ["team", "lead"],
            ["ops", "Ann"],
          ],
        },
      ],
      "xlsx",
    );
    const output = await inspect(path);
    expect(output.text).toContain("payroll.xlsx: xlsx");
    expect(output.text).toContain(
      'Table payroll_payroll (sheet "Payroll"): 4 rows x 5 columns, header row 4',
    );
    expect(output.text).toContain(
      "Salary | mixed (1 value is not number; NULL in SQL) | 0 | 3 | 1000 | 2000.5",
    );
    expect(output.text).toContain("Start date | date | 1 | 3 | 2022-12-31 | 2024-01-15");
    expect(output.text).toContain("Active | boolean | 0 | 2 | false | true");
    expect(output.text).toContain(
      'Table payroll_teams (sheet "Teams"): 1 row x 2 columns, header row 1',
    );
    expect(
      await sql("SELECT count(*) AS n FROM payroll_payroll WHERE Department = 'eng'"),
    ).toContain("\n2");
  });

  it("identifies an .xlsx named .csv", async () => {
    await setUp();
    const realXlsx = join(test.dataDirectory, "real.xlsx");
    await writeWorkbook(
      realXlsx,
      [
        {
          name: "Data",
          rows: [
            ["a", "b"],
            [1, 2],
          ],
        },
      ],
      "xlsx",
    );
    const disguised = join(test.dataDirectory, "export.csv");
    await copyFile(realXlsx, disguised);
    const output = await inspect(disguised);
    expect(output.text).toContain("export.csv: xlsx");
    expect(output.text).toContain("Note: The file named .csv but its content is xlsx.");
    expect(test.registry.find(disguised)?.format).toBe("xlsx");
  });

  it("rejects an unknown sheet in the header override", async () => {
    await setUp();
    const path = join(test.dataDirectory, "plan.xlsx");
    await writeWorkbook(path, [{ name: "Plan", rows: [["a"], [1]] }], "xlsx");
    await expect(inspect(path, { sheet: "Budget", header_row: 2 })).rejects.toThrow(
      'No sheet or table "Budget". This file has: "Plan".',
    );
  });
});

describe("inspect_data on legacy .xls", () => {
  it("converts each sheet to a row set with exact dates", async () => {
    await setUp();
    const path = join(test.dataDirectory, "legacy.xls");
    await writeWorkbook(path, [{ name: "Payroll", rows: payrollRows }], "biff8");
    const output = await inspect(path);
    expect(output.text).toContain("legacy.xls: xls");
    expect(output.text).toContain(
      'Table legacy (sheet "Payroll"): 4 rows x 5 columns, header row 4',
    );
    expect(output.text).toContain("Start date | date | 1 | 3 | 2022-12-31 | 2024-01-15");
    expect(output.text).toContain("Salary | mixed");
    const rowsHandle = test.registry.find(path)?.tables[0]?.rowsHandle ?? "";
    expect(output.handles).toContain(rowsHandle);
    expect(await sql('SELECT min("Start date") AS first FROM legacy')).toContain("2022-12-31");
  });
});

describe("inspect_data on .docx", () => {
  it("lists the outline and tables, and stores each table as a queryable row set", async () => {
    await setUp();
    const path = join(test.dataDirectory, "board report.docx");
    await writeDocx(
      path,
      [
        docxParagraph("Board report", "Titel"),
        docxParagraph("Some intro text."),
        docxParagraph("Headcount", "berschrift1"),
        docxTable([
          ["Team", "People"],
          ["ops", "4"],
          ["eng", "12"],
        ]),
        docxParagraph("Q3 results", "Heading2"),
        docxTable([
          ["Region", "Revenue", "Cost"],
          ["North", "1,200", "800"],
          ["South", "950.5", "n/a"],
        ]),
        docxTable([["Only a header"]]),
      ].join(""),
    );
    const output = await inspect(path);
    expect(output.text).toContain("board report.docx: docx");
    expect(output.text).toContain("Outline:\n# Board report\n# Headcount\n## Q3 results");
    expect(output.text).toContain(
      'Table board_report_table_1 (table 1 under "Headcount"): 2 rows x 2 columns, header row 1',
    );
    expect(output.text).toContain(
      'Table board_report_table_2 (table 2 under "Q3 results"): 2 rows x 3 columns, header row 1',
    );
    expect(output.text).toContain("Revenue | number");
    expect(output.text).toContain("Cost | mixed (1 of 2 values are not numbers; SQL sees text)");
    expect(output.text).toContain(
      'Table 3 under "Q3 results": 0 rows x 0 columns, header row 1. No data rows',
    );
    expect(await sql("SELECT sum(Revenue) AS total FROM board_report_table_2")).toContain("2150.5");
  });
});

describe("inspect_data caching and errors", () => {
  it("reuses a profile until the file changes", async () => {
    await setUp();
    const path = await test.writeFixture("cache.csv", "a,b\n1,2\n");
    const first = await inspect(path);
    const second = await inspect(path);
    expect(second).toBe(first);
    expect(test.results.handles()).toHaveLength(1);

    await writeFile(path, "a,b\n1,2\n3,4\n");
    await utimes(path, new Date(), new Date(Date.now() + 5_000));
    const third = await inspect(path);
    expect(third.text).toContain("2 rows x 2 columns");
    expect(test.results.handles()).toHaveLength(2);
    expect(test.registry.find(path)?.tables[0]?.sqlName).toBe("cache");
  });

  it("refuses a protected path", async () => {
    await setUp();
    const path = await test.writeFixture("secret.csv", "a\n1\n");
    test.context = {
      ...test.context,
      paths: new FixedPathPolicy({ allowedRoots: [test.dataDirectory], deniedPaths: [path] }),
    };
    await expect(inspect(path)).rejects.toThrow(ToolError);
  });

  it("refuses a binary file that is not a supported format", async () => {
    await setUp();
    const path = join(test.dataDirectory, "photo.png");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await expect(inspect(path)).rejects.toThrow(/binary file/);
  });

  it("explains a missing file", async () => {
    await setUp();
    await expect(inspect(join(test.dataDirectory, "nope.csv"))).rejects.toThrow(/No file at/);
  });
});
