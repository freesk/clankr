import { describe, expect, it } from "vitest";
import { stripPaths } from "./query-errors.ts";
import { identifiersIn, quoteIdentifier, quoteLiteral } from "./sql-text.ts";

describe("SQL text helpers", () => {
  it("quotes literals and identifiers", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
    expect(quoteIdentifier('a "b"')).toBe('"a ""b"""');
  });

  it("finds identifiers, unquoting quoted ones and skipping string literals", () => {
    const found = identifiersIn(`SELECT "Start date" FROM Payroll p WHERE dept = 'sales'`);
    expect(found.has("start date")).toBe(true);
    expect(found.has("payroll")).toBe(true);
    expect(found.has("sales")).toBe(false);
  });

  it("strips absolute and home paths from messages", () => {
    expect(
      stripPaths('Cannot open file "/Users/me/Documents/pay.xlsx": not allowed (~/x/y.csv)'),
    ).toBe('Cannot open file "pay.xlsx": not allowed (y.csv)');
  });
});
