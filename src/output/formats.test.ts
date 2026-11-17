import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { outputFormats } from "../contracts/index.ts";
import {
  chartOutputFormats,
  formatFromPath,
  formatsNamedIn,
  holdsSeveralCharts,
  tableOutputFormats,
} from "./formats.ts";
import { firstFreeName, slugFromTitle, splitOutputPath } from "./naming.ts";

describe("the format list", () => {
  it("is one list: every chart and table format is in it", () => {
    expect(outputFormats).toEqual(["xlsx", "docx", "pdf", "png", "svg", "csv"]);
    for (const format of [...chartOutputFormats, ...tableOutputFormats]) {
      expect(outputFormats).toContain(format);
    }
    expect(chartOutputFormats.filter(holdsSeveralCharts)).toEqual(["pdf", "docx", "xlsx"]);
  });

  it("recognises a format from a path's extension, whatever its case", () => {
    expect(formatFromPath("/a/report.DOCX")).toBe("docx");
    expect(formatFromPath("out.xlsx")).toBe("xlsx");
    expect(formatFromPath("chart.svg")).toBe("svg");
    expect(formatFromPath("notes.txt")).toBeUndefined();
    expect(formatFromPath("no-extension")).toBeUndefined();
  });
});

describe("formatsNamedIn (D86)", () => {
  it.each([
    ["Chart sales by region and save it as a PDF", ["pdf"]],
    ["put that in a Word document please", ["docx"]],
    ["export it to Excel", ["xlsx"]],
    ["save as report.docx", ["docx"]],
    ["I need a spreadsheet and a picture of it", ["xlsx", "png"]],
    ["give me the rows as CSV", ["csv"]],
    ["an SVG, not a PNG", ["png", "svg"]],
  ])("finds the formats in %j", (text, expected) => {
    expect(formatsNamedIn(text)).toEqual(expected);
  });

  it.each([
    "Chart monthly headcount by department as a stacked bar",
    "in other words, show the totals",
    "count the passwords per pdfinfo run",
  ])("finds none in %j", (text) => {
    expect(formatsNamedIn(text)).toEqual([]);
  });

  it("counts a data file's own name, which only ever trusts the model as before", () => {
    expect(formatsNamedIn("Chart headcount from payroll_2025.xlsx")).toEqual(["xlsx"]);
  });
});

describe("naming an output file (D28)", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "clankr-output-naming-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("makes a file-name-safe name from a title", () => {
    expect(slugFromTitle("Revenue by Region, 2026", "table")).toBe("revenue-by-region-2026");
    expect(slugFromTitle("!!!", "table")).toBe("table");
  });

  it("splits an explicit path into folder and base name, dropping a format extension", () => {
    expect(splitOutputPath("/a/b/q1 report.pdf")).toEqual({
      folder: "/a/b",
      baseName: "q1 report",
    });
    expect(splitOutputPath("/a/b/q1.docx")).toEqual({ folder: "/a/b", baseName: "q1" });
    expect(splitOutputPath("/a/b/q1.xlsx")).toEqual({ folder: "/a/b", baseName: "q1" });
    expect(splitOutputPath("/a/b/notes")).toEqual({ folder: "/a/b", baseName: "notes" });
    expect(splitOutputPath("/a/b/v1.2")).toEqual({ folder: "/a/b", baseName: "v1.2" });
  });

  it("appends a number until every file under the name is free", async () => {
    const pathsFor = (name: string) => [join(folder, `${name}.docx`), join(folder, `${name}.sql`)];
    expect(await firstFreeName(folder, "sales", pathsFor)).toBe("sales");
    await writeFile(join(folder, "sales.docx"), "");
    await writeFile(join(folder, "sales-2.sql"), "");
    expect(await firstFreeName(folder, "sales", pathsFor)).toBe("sales-3");
  });
});
