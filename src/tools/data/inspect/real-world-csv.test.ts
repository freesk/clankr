// Delimited files as real exports come: not UTF-8, and with a column whose type changes
// far down the file. Both were found on Government of Alberta open data (ROADMAP task 28).

import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { SessionDataSourceRegistry } from "../../../data/index.ts";
import {
  createSqlTestContext,
  type SqlTestContext,
} from "../../../engines/duckdb/testing/sql-test-context.ts";
import { querySqlTool } from "../query-sql.ts";
import { inspectDataTool } from "./inspect-data.ts";
import { isUtf8File, writeUtf8Copy } from "./text-encoding.ts";

let test: SqlTestContext;

afterEach(async () => {
  await test?.cleanup();
});

async function setUp(): Promise<SqlTestContext> {
  test = await createSqlTestContext({ dataSources: new SessionDataSourceRegistry() });
  return test;
}

async function sql(text: string): Promise<string> {
  return (await querySqlTool.run({ sql: text }, test.context)).text;
}

// "Elder’s" with the curly apostrophe as Windows-1252 byte 0x92, which is not valid UTF-8.
const windows1252Csv = Buffer.concat([
  Buffer.from("city,shelter,capacity\nEdmonton,Elder"),
  Buffer.from([0x92]),
  Buffer.from("s Caring Shelter,40\nCalgary,Drop In,120\n"),
]);

describe("text encoding", () => {
  it("tells UTF-8 from Windows-1252 and converts the latter", async () => {
    await setUp();
    const path = await test.writeFixture("shelters.csv", "");
    await writeFile(path, windows1252Csv);
    expect(await isUtf8File(path)).toBe(false);
    const copy = await writeUtf8Copy(path, test.context.clankrPaths.session.scratch);
    expect(await isUtf8File(copy)).toBe(true);
  });
});

describe("inspect_data on real-world CSV exports", () => {
  it("reads a Windows-1252 file and keeps its characters intact in SQL", async () => {
    await setUp();
    const path = await test.writeFixture("shelters.csv", "");
    await writeFile(path, windows1252Csv);
    const output = await inspectDataTool.run({ path }, test.context);
    expect(output.text).toContain("Windows-1252 text read as UTF-8");
    expect(await sql("SELECT shelter FROM shelters WHERE city = 'Edmonton'")).toContain(
      "Elder’s Caring Shelter",
    );
  });

  it("re-guesses types from every row when a later value breaks the guess", async () => {
    await setUp();
    // DuckDB samples about 20,000 rows; the text value sits well past that.
    const lines = ["place,age,people"];
    for (let row = 0; row < 30_000; row++) lines.push(`Town${row % 7},${row % 90},${row % 50}`);
    lines.push("Town1,90+,12");
    const path = await test.writeFixture("population.csv", `${lines.join("\n")}\n`);
    const output = await inspectDataTool.run({ path }, test.context);
    expect(output.text).toContain("30,001 rows x 3 columns");
    expect(await sql("SELECT people FROM population WHERE age = '90+'")).toContain("12");
  });
});
