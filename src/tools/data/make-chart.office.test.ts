// make_chart as a Word document and as an Excel workbook. The isolate and the browser are
// stand-ins; the files are real and are read back with other readers: the project's OOXML
// reader, macOS textutil, SheetJS, and DuckDB through inspect_data.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Row } from "../../contracts/index.ts";
import { isBrowserVendored } from "../../engines/browser/index.ts";
import { isExcelExtensionInstalled } from "../../engines/duckdb/index.ts";
import { readPackagePart, textutilText } from "../../output/testing/read-back.ts";
import { isPng } from "../../shared/png-size.ts";
import { readDocxStructure } from "./inspect/docx-document.ts";
import { inspectDataTool } from "./inspect/inspect-data.ts";
import { querySqlTool } from "./query-sql.ts";
import { type ChartTestKit, chartRows, createChartTestKit } from "./testing/chart-test-kit.ts";

describe.skipIf(!isBrowserVendored())(
  "make_chart office formats (needs the vendored schema)",
  () => {
    let kit: ChartTestKit;

    beforeEach(async () => {
      kit = await createChartTestKit();
    });

    afterEach(async () => {
      await kit.cleanup();
    });

    async function documentXml(path: string): Promise<string> {
      return (await readPackagePart(path, "word/document.xml")).toString("utf8");
    }

    function writeTheme(theme: Record<string, unknown>): Promise<void> {
      return writeFile(kit.context.clankrPaths.themeFile, JSON.stringify(theme));
    }

    describe("docx", () => {
      it("writes the title, the chart as an embedded PNG, and the summary as text", async () => {
        const output = await kit.tool().run({ code: kit.oneChart, format: "docx" }, kit.context);
        const path = join(kit.folder, "pay-by-department.docx");
        expect(output.text).toContain(`Saved chart: ${path}`);
        expect(output.text).toContain("Word document");
        expect(output.text).toContain("Summary: printed under the chart.");
        expect(output.text).toContain(
          "Saved beside it: pay-by-department.chart.js, pay-by-department.vl.json, pay-by-department.sql",
        );
        // The browser drew a picture for the document; no PDF, PNG, or SVG file was asked for.
        expect(kit.renderer.images).toHaveLength(1);
        expect(kit.renderer.requests).toEqual([]);
        // The title is the document's heading, so it is not drawn into the picture a second time.
        expect(kit.renderer.images[0]).not.toHaveProperty("title");
        expect(kit.renderer.images[0]).toHaveProperty("mark", "bar");

        expect(isPng(await readPackagePart(path, "word/media/image1.png"))).toBe(true);
        expect((await readDocxStructure(path)).headings).toEqual([
          { level: 1, text: "Pay by department" },
        ]);
        const text = await textutilText(path);
        expect(text).toContain("Pay by department");
        expect(text).toContain("Sales is paid most.");
      });

      it("puts several charts in one document, a page each, portrait like the PDF", async () => {
        await writeTheme({
          page: { size: "Letter", orientation: "landscape" },
          footer: "Internal use only",
        });
        const output = await kit.tool().run({ code: kit.twoCharts, format: "docx" }, kit.context);
        const path = join(kit.folder, "pay-first-half.docx");
        expect(output.text).toContain(`Saved 2 charts: ${path}`);
        expect(output.text).toContain("Word document, portrait, one chart per page");
        expect(output.text).toContain("Summaries: printed under each chart.");
        expect(kit.renderer.images).toHaveLength(2);

        for (const part of ["word/media/image1.png", "word/media/image2.png"]) {
          expect(isPng(await readPackagePart(path, part))).toBe(true);
        }
        expect((await readDocxStructure(path)).headings.map((heading) => heading.text)).toEqual([
          "Pay: first/half",
          "Pay second",
        ]);
        const xml = await documentXml(path);
        expect(xml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
        expect(xml).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
        expect((await readPackagePart(path, "word/footer1.xml")).toString()).toContain(
          "Internal use only",
        );
        const text = await textutilText(path);
        expect(text.indexOf("First finding.")).toBeGreaterThan(-1);
        expect(text.indexOf("Second finding.")).toBeGreaterThan(text.indexOf("First finding."));
      });

      it("keeps the theme's landscape page for a single chart, and never overwrites", async () => {
        await writeTheme({ page: { size: "A4", orientation: "landscape" } });
        const chartTool = kit.tool();
        await chartTool.run({ code: kit.oneChart, format: "docx" }, kit.context);
        const second = await chartTool.run({ code: kit.oneChart, format: "docx" }, kit.context);
        const secondPath = join(kit.folder, "pay-by-department-2.docx");
        expect(second.text).toContain(secondPath);
        expect(await documentXml(secondPath)).toContain(
          '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>',
        );
      });
    });

    describe("xlsx", () => {
      it("writes a Summary sheet and one typed data sheet per chart, and says so", async () => {
        const output = await kit.tool().run({ code: kit.twoCharts, format: "xlsx" }, kit.context);
        const path = join(kit.folder, "pay-first-half.xlsx");
        expect(output.text).toContain(`Saved 2 charts: ${path}`);
        expect(output.text).toContain("Excel workbook");
        expect(output.text).toContain("The workbook holds no picture");
        expect(output.text).toContain("Summaries: on the Summary sheet.");
        expect(kit.renderer.images).toEqual([]);

        const workbook = XLSX.read(await readFile(path), { dense: true, cellNF: true });
        expect(workbook.SheetNames).toEqual(["Summary", "Pay first half", "Pay second"]);
        const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Summary as XLSX.WorkSheet);
        expect(summary).toEqual([
          {
            Chart: 1,
            Title: "Pay: first/half",
            Summary: "First finding.",
            "Data sheet": "Pay first half",
            Rows: 3,
          },
          {
            Chart: 2,
            Title: "Pay second",
            Summary: "Second finding.",
            "Data sheet": "Pay second",
            Rows: 3,
          },
        ]);
        const data = (workbook.Sheets["Pay second"] as XLSX.DenseSheet)["!data"];
        expect(data[0]?.map((cell) => cell?.v)).toEqual(["month", "dept", "total"]);
        expect(data[2]?.[2]).toMatchObject({ t: "n", v: 135.5 });
        expect(XLSX.SSF.is_date(String(data[1]?.[0]?.z))).toBe(true);
      });

      it.skipIf(!isExcelExtensionInstalled())(
        "gives DuckDB the chart's rows back with their types",
        async () => {
          const { context } = kit;
          await kit.tool().run({ code: kit.oneChart, format: "xlsx" }, context);
          const path = join(kit.folder, "pay-by-department.xlsx");
          const profile = (await inspectDataTool.run({ path, sheet: "Pay by department" }, context))
            .text;
          expect(profile).toContain("\nmonth | date");
          expect(profile).toContain("\ntotal | number");
          const table = kit.test.registry
            .find(path)
            ?.tables.find((candidate) => candidate.label === "Pay by department")?.sqlName;
          const result = await querySqlTool.run(
            { sql: `SELECT month, dept, total FROM ${table} ORDER BY total` },
            context,
          );
          const readBack: Row[] = [];
          for await (const row of context.results.readRows(result.handles?.[0] ?? "")) {
            readBack.push(row);
          }
          expect(readBack).toEqual(
            [...chartRows].sort((a, b) => Number(a.total) - Number(b.total)),
          );
        },
      );
    });
  },
);
