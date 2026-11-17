// The Excel writer: sheet naming, and cell types read back with SheetJS. Reading a written
// workbook back through inspect_data and DuckDB is in src/tools/data/export-table.test.ts.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Row } from "../contracts/index.ts";
import { serialToIsoDate } from "../shared/excel-dates.ts";
import { describeTable } from "./table-data.ts";
import { buildWorkbook, uniqueSheetNames } from "./xlsx-writer.ts";

describe("uniqueSheetNames", () => {
  it("keeps valid names and repairs what Excel refuses", () => {
    expect(
      uniqueSheetNames([
        "Summary",
        "Revenue: North/South [2025]?",
        "'quoted'",
        "",
        "A name far longer than the thirty-one characters Excel allows",
      ]),
    ).toEqual([
      "Summary",
      "Revenue North South 2025",
      "quoted",
      "Sheet4",
      "A name far longer than the thir",
    ]);
  });

  it("numbers names that clash, ignoring case, and stays within 31 characters", () => {
    const longName = "Population by municipality, 2001";
    const names = uniqueSheetNames(["Sales", "sales", "SALES", longName, longName]);
    expect(names.slice(0, 3)).toEqual(["Sales", "sales (2)", "SALES (3)"]);
    expect(names[4]).toBe("Population by municipality, (2)");
    for (const name of names) expect(name.length).toBeLessThanOrEqual(31);
  });
});

describe("buildWorkbook", () => {
  const rows: Row[] = [
    { name: "Ann", salary: 1000.5, hired: "2024-01-15", active: true, seen: "2024-03-01 10:30:00" },
    { name: "Bob", salary: 2000, hired: "2023-06-01", active: false, seen: "2024-03-02" },
    { name: null, salary: null, hired: null, active: null, seen: null },
  ];

  async function readBack(sheets: Parameters<typeof buildWorkbook>[0]) {
    const bytes = await buildWorkbook(sheets);
    return XLSX.read(bytes, { type: "buffer", dense: true, cellNF: true });
  }

  function cells(workbook: XLSX.WorkBook, sheetName: string): (XLSX.CellObject | undefined)[][] {
    const sheet = workbook.Sheets[sheetName] as XLSX.DenseSheet;
    return sheet["!data"].map((row) => Array.from(row ?? []));
  }

  it("writes a header row and typed cells: numbers, booleans, dates, text", async () => {
    const workbook = await readBack([{ name: "People", table: describeTable(rows) }]);
    expect(workbook.SheetNames).toEqual(["People"]);
    const [header, ann, bob, empty] = cells(workbook, "People");
    expect(header?.map((cell) => cell?.v)).toEqual(["name", "salary", "hired", "active", "seen"]);

    expect(ann?.[0]).toMatchObject({ t: "s", v: "Ann" });
    expect(ann?.[1]).toMatchObject({ t: "n", v: 1000.5 });
    expect(ann?.[3]).toMatchObject({ t: "b", v: true });
    expect(bob?.[3]).toMatchObject({ t: "b", v: false });

    // A date is a number with a date format, which is what makes Excel treat it as a date.
    const hired = ann?.[2];
    expect(hired?.t).toBe("n");
    expect(XLSX.SSF.is_date(String(hired?.z))).toBe(true);
    expect(serialToIsoDate(Number(hired?.v), false)).toBe("2024-01-15");
    const seen = ann?.[4];
    expect(XLSX.SSF.is_date(String(seen?.z))).toBe(true);
    expect(serialToIsoDate(Number(seen?.v), false)).toBe("2024-03-01 10:30:00");
    // A plain date in a date-time column is midnight of that day.
    expect(serialToIsoDate(Number(bob?.[4]?.v), false)).toBe("2024-03-02");

    expect((empty ?? []).every((cell) => cell === undefined || cell.v === undefined)).toBe(true);
  });

  it("keeps date-like text as text when the column is not all dates", async () => {
    const mixed: Row[] = [{ note: "2024-01-15" }, { note: "see 2024-02-01" }];
    const workbook = await readBack([{ name: "Notes", table: describeTable(mixed) }]);
    const [, first] = cells(workbook, "Notes");
    expect(first?.[0]).toMatchObject({ t: "s", v: "2024-01-15" });
  });

  it("writes nested values as JSON text and keeps the sheet order", async () => {
    const nested: Row[] = [{ id: 1, tags: ["a", "b"] }];
    const workbook = await readBack([
      { name: "Summary", table: describeTable([{ Chart: 1, Title: "One" }]) },
      { name: "One", table: describeTable(nested) },
    ]);
    expect(workbook.SheetNames).toEqual(["Summary", "One"]);
    expect(cells(workbook, "One")[1]?.[1]).toMatchObject({ t: "s", v: '["a","b"]' });
  });

  it("uses the stored column order when it is given", async () => {
    const table = describeTable([{ b: 1, a: 2 }], ["a", "b"]);
    const workbook = await readBack([{ name: "Order", table }]);
    expect(cells(workbook, "Order")[0]?.map((cell) => cell?.v)).toEqual(["a", "b"]);
  });
});
