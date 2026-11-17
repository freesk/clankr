// export_table, proved by reading its files back: an .xlsx through inspect_data and DuckDB,
// a .docx through the project's OOXML reader and macOS textutil, a .csv through DuckDB.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeRenderer } from "../../chart/test-support.ts";
import { type OutputFormat, type Row, type ToolContext, ToolError } from "../../contracts/index.ts";
import { SessionDataSourceRegistry } from "../../data/index.ts";
import { isExcelExtensionInstalled } from "../../engines/duckdb/index.ts";
import {
  createSqlTestContext,
  type SqlTestContext,
} from "../../engines/duckdb/testing/sql-test-context.ts";
import { textutilText } from "../../output/testing/read-back.ts";
import { createExportTableTool } from "./export-table.ts";
import { readDocxStructure } from "./inspect/docx-document.ts";
import { inspectDataTool } from "./inspect/inspect-data.ts";
import { querySqlTool } from "./query-sql.ts";

const salesCsv = [
  "region,units,price,sold_on,note",
  "north,10,2.5,2024-01-05,first order",
  "south,20,3.25,2024-02-10,",
  'east,5,10,2024-03-01,"a, quoted ""note"""',
  "",
].join("\n");
const everyRow = "SELECT region, units, price, sold_on, note FROM sales ORDER BY units";

describe("export_table", () => {
  let test: SqlTestContext;
  let context: ToolContext;
  let dataFile: string;
  let renderer: ReturnType<typeof createFakeRenderer>;

  beforeEach(async () => {
    test = await createSqlTestContext({ dataSources: new SessionDataSourceRegistry() });
    context = test.context;
    dataFile = await test.writeFixture("sales.csv", salesCsv);
    await inspectDataTool.run({ path: dataFile }, context);
    renderer = createFakeRenderer();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  const tool = () => createExportTableTool({ renderTable: renderer.renderTable });

  /** Runs a query and returns the handle of its stored rows. */
  async function query(sql: string): Promise<string> {
    const output = await querySqlTool.run({ sql }, context);
    return output.handles?.[0] ?? "";
  }

  async function rowsOf(handle: string): Promise<Row[]> {
    const rows: Row[] = [];
    for await (const row of context.results.readRows(handle)) rows.push(row);
    return rows;
  }

  function savedPath(text: string): string {
    return /Saved table: (.+?) \(/.exec(text)?.[1] ?? "";
  }

  describe.skipIf(!isExcelExtensionInstalled())("xlsx", () => {
    it("writes typed cells that inspect_data and DuckDB read back unchanged", async () => {
      const handle = await query(everyRow);
      const output = await tool().run({ handle, title: "Sales export", format: "xlsx" }, context);
      const path = savedPath(output.text);
      expect(path).toBe(join(dirname(dataFile), "sales-export.xlsx"));
      expect(output.text).toContain("Excel workbook");
      expect(output.text).toContain("3 rows, 5 columns.");

      const profile = (await inspectDataTool.run({ path }, context)).text;
      expect(profile).toContain("3 rows x 5 columns, header row 1");
      expect(profile).toContain("\nregion | text");
      expect(profile).toContain("\nunits | number");
      expect(profile).toContain("\nprice | number");
      expect(profile).toContain("\nsold_on | date");

      const table = test.registry.find(path)?.tables[0]?.sqlName;
      const readBack = await rowsOf(
        await query(`SELECT region, units, price, sold_on, note FROM ${table} ORDER BY units`),
      );
      expect(readBack).toEqual(await rowsOf(handle));
      expect(readBack[0]).toEqual({
        region: "east",
        units: 5,
        price: 10,
        sold_on: "2024-03-01",
        note: 'a, quoted "note"',
      });
    });

    it("refuses more rows than the sheet limit and says how to shrink the result", async () => {
      context.config.output.maxSheetRows = 2;
      const handle = await query(everyRow);
      const error = await tool()
        .run({ handle, format: "xlsx" }, context)
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ToolError);
      expect((error as Error).message).toMatch(
        /3 rows; an XLSX table holds at most 2\. Aggregate first with query_sql.*or use format csv/,
      );
    });
  });

  it("writes a Word table that our reader and textutil both read", async () => {
    const handle = await query(everyRow);
    const output = await tool().run({ handle, title: "Sales by region", format: "docx" }, context);
    const path = savedPath(output.text);
    expect(path).toBe(join(dirname(dataFile), "sales-by-region.docx"));

    const structure = await readDocxStructure(path);
    expect(structure.headings).toEqual([{ level: 1, text: "Sales by region" }]);
    expect(structure.tables[0]?.grid).toEqual([
      ["region", "units", "price", "sold_on", "note"],
      ["east", "5", "10", "2024-03-01", 'a, quoted "note"'],
      ["north", "10", "2.5", "2024-01-05", "first order"],
      ["south", "20", "3.25", "2024-02-10", ""],
    ]);

    const text = await textutilText(path);
    for (const expected of ["Sales by region", "sold_on", "first order", "3.25", "2024-02-10"]) {
      expect(text).toContain(expected);
    }
  });

  it("writes a CSV file DuckDB reads back unchanged, named apart from the data file", async () => {
    const handle = await query(everyRow);
    const output = await tool().run({ handle, format: "csv" }, context);
    const path = savedPath(output.text);
    // Named after the data file, whose own name is taken: nothing is overwritten (D28).
    expect(path).toBe(join(dirname(dataFile), "sales-2.csv"));
    expect(await readFile(dataFile, "utf8")).toBe(salesCsv);

    await inspectDataTool.run({ path }, context);
    const table = test.registry.find(path)?.tables[0]?.sqlName;
    const readBack = await rowsOf(
      await query(`SELECT region, units, price, sold_on, note FROM ${table} ORDER BY units`),
    );
    expect(readBack).toEqual(await rowsOf(handle));
  });

  it("hands a PDF table to the offline renderer as text cells", async () => {
    const handle = await query("SELECT region, units FROM sales ORDER BY units");
    const output = await tool().run({ handle, title: "Units", format: "pdf" }, context);
    expect(output.text).toContain("PDF document, 1 page");
    expect(renderer.tableRequests).toHaveLength(1);
    const request = renderer.tableRequests[0];
    expect(request).toMatchObject({
      title: "Units",
      columns: ["region", "units"],
      cells: [
        ["east", "5"],
        ["north", "10"],
        ["south", "20"],
      ],
      numericColumns: [false, true],
      outputPath: join(dirname(dataFile), "units.pdf"),
    });
  });

  it.each(["docx", "pdf"] as const)(
    "caps a %s table and tells the model to aggregate",
    async (format) => {
      context.config.output.maxDocumentTableRows = 2;
      const handle = await query(everyRow);
      await expect(tool().run({ handle, format }, context)).rejects.toThrow(
        /3 rows; a (DOCX|PDF) table holds at most 2\. Aggregate first with query_sql.*xlsx or csv/,
      );
      expect((await readdir(dirname(dataFile))).sort()).toEqual(["sales.csv"]);
    },
  );

  it.each(["png", "svg"] as const)("points a %s request at make_chart", async (format) => {
    const handle = await query(everyRow);
    await expect(tool().run({ handle, format }, context)).rejects.toThrow(
      /is a picture, and export_table writes tables\. Use make_chart.*xlsx, docx, pdf, csv/,
    );
  });

  it("never overwrites: a second export and an explicit path both get a number", async () => {
    const handle = await query(everyRow);
    const first = await tool().run({ handle, title: "Report", format: "docx" }, context);
    const second = await tool().run({ handle, title: "Report", format: "docx" }, context);
    expect(savedPath(first.text)).toBe(join(dirname(dataFile), "report.docx"));
    expect(savedPath(second.text)).toBe(join(dirname(dataFile), "report-2.docx"));

    const taken = join(context.workingDirectory, "out", "table.docx");
    const explicit = await tool().run({ handle, output_path: "out/table.docx" }, context);
    expect(savedPath(explicit.text)).toBe(taken);
    const again = await tool().run({ handle, output_path: "out/table.docx" }, context);
    expect(savedPath(again.text)).toBe(join(context.workingDirectory, "out", "table-2.docx"));
  });

  it("previews the write: the folder beside the data file and the data file itself", async () => {
    const handle = await query(everyRow);
    const preview = await tool().previewChange?.({ handle, format: "xlsx" }, context);
    expect(preview).toEqual({
      summary: `Export 3 rows, 5 columns from ${handle} to an XLSX file in ${dirname(dataFile)}`,
      targetPaths: [dirname(dataFile)],
      dataSourcePaths: [dataFile],
    });
    const explicit = await tool().previewChange?.({ handle, output_path: "~/out.pdf" }, context);
    expect(explicit?.summary).toContain("to a PDF file in");
    expect(explicit?.targetPaths[0]).toMatch(/out\.pdf$/);
  });

  it("is a write tool in the data group, with a two-sentence description", () => {
    const definition = tool();
    expect(definition.permission).toBe("write");
    expect(definition.groups).toEqual(["data"]);
    expect(definition.description.match(/[.!?](\s|$)/g)).toHaveLength(2);
  });

  it("refuses a handle that is not a row set, and an empty one", async () => {
    const textHandle = await context.results.putText("just text", { tool: "t", arguments: {} });
    await expect(tool().run({ handle: textHandle, format: "csv" }, context)).rejects.toThrow(
      /is not a stored row set/,
    );
    await expect(tool().run({ handle: "r999", format: "csv" }, context)).rejects.toThrow(
      /is not a stored row set/,
    );
    const empty = await query("SELECT region FROM sales WHERE units > 1000");
    await expect(tool().run({ handle: empty, format: "csv" }, context)).rejects.toThrow(
      /has no rows, so there is nothing to export/,
    );
  });

  describe("choosing the format (D85)", () => {
    it("fails without a format when nobody can be asked, naming the formats and --format", async () => {
      const handle = await query(everyRow);
      const error = await tool()
        .run({ handle }, context)
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ToolError);
      expect((error as Error).message).toMatch(/xlsx, docx, pdf, csv.*--format <name>/);
      expect((await readdir(dirname(dataFile))).sort()).toEqual(["sales.csv"]);
    });

    it("asks the user, offering only formats that hold a table", async () => {
      const handle = await query(everyRow);
      const offered: (readonly OutputFormat[])[] = [];
      const asking: ToolContext = {
        ...context,
        outputFormat: {
          // A picture format set for charts earlier does not fit a table, so the user is asked.
          sessionFormat: "png",
          ask: async (question) => {
            offered.push(question.formats);
            return "csv";
          },
        },
      };
      const preview = await tool().previewChange?.({ handle }, asking);
      expect(preview?.summary).toContain("to a file (you choose the format next)");
      const output = await tool().run({ handle, title: "Asked" }, asking);
      expect(offered).toEqual([["xlsx", "docx", "pdf", "csv"]]);
      expect(savedPath(output.text)).toBe(join(dirname(dataFile), "asked.csv"));
    });

    it("uses the session format when it holds a table", async () => {
      const handle = await query(everyRow);
      const session: ToolContext = { ...context, outputFormat: { sessionFormat: "docx" } };
      const output = await tool().run({ handle, title: "From session" }, session);
      expect(savedPath(output.text)).toBe(join(dirname(dataFile), "from-session.docx"));
    });
  });
});
