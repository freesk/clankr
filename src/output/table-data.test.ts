import { describe, expect, it } from "vitest";
import type { Row } from "../contracts/index.ts";
import { isoDateToSerial, serialToIsoDate } from "../shared/excel-dates.ts";
import { cellText, describeTable, textGrid } from "./table-data.ts";

describe("isoDateToSerial", () => {
  it("is the inverse of serialToIsoDate for dates and date-times", () => {
    expect(isoDateToSerial("2024-01-15")).toEqual({ serial: 45306, hasTime: false });
    expect(isoDateToSerial("2024-01-15 10:30:00")).toEqual({ serial: 45306.4375, hasTime: true });
    for (const text of ["1999-12-31", "2024-02-29", "2031-07-04 23:59:59"]) {
      expect(serialToIsoDate(isoDateToSerial(text)?.serial ?? 0, false)).toBe(text);
    }
  });

  it.each([
    ["2024-02-31", "a day that does not exist"],
    ["2024-13-01", "a month that does not exist"],
    ["15/01/2024", "another date order"],
    ["2024-01-15 10:30", "a time without seconds"],
    ["1899-12-31", "a date before Excel's calendar"],
    ["2024", "a year alone"],
  ])("leaves %s as text (%s)", (text) => {
    expect(isoDateToSerial(text)).toBeUndefined();
  });
});

describe("describeTable", () => {
  const rows: Row[] = [
    { id: 1, day: "2024-01-15", at: "2024-01-15 08:00:00", note: "a", flag: true, mixed: 1 },
    { id: 2, day: "2024-01-16", at: "2024-01-16", note: "2024-01-01", flag: false, mixed: "x" },
    { id: null, day: null, at: null, note: null, flag: null, mixed: null },
  ];

  it("types a column from every value in it", () => {
    const kinds = Object.fromEntries(
      describeTable(rows).columns.map((column) => [column.name, column.kind]),
    );
    expect(kinds).toEqual({
      id: "number",
      day: "date",
      at: "datetime",
      note: "other",
      flag: "other",
      mixed: "other",
    });
  });

  it("finds the columns of rows that do not all have the same keys", () => {
    const table = describeTable([{ a: 1 }, { b: 2, a: 3 }]);
    expect(table.columns.map((column) => column.name)).toEqual(["a", "b"]);
    expect(textGrid(table)).toEqual([
      ["1", ""],
      ["3", "2"],
    ]);
  });

  it("writes a cell as a reader expects to see it", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(12.5)).toBe("12.5");
    expect(cellText(false)).toBe("false");
    expect(cellText({ a: [1] })).toBe('{"a":[1]}');
  });
});
