// Each committed sample inspects to the expected tables, header rows, and column
// types, and answers an aggregate query with numbers computed from the generator's
// own data, never from DuckDB.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { officeHeadcount, quarterlyRevenue } from "../../evals/fixtures/samples/board-report.ts";
import { budgetLines } from "../../evals/fixtures/samples/budget-legacy.ts";
import { inventoryRows } from "../../evals/fixtures/samples/inventory.ts";
import {
  monthlyDepartmentCosts,
  payrollEmployees,
} from "../../evals/fixtures/samples/payroll-2025.ts";
import { salesRowCount, salesRows } from "../../evals/fixtures/samples/sales-2025.ts";
import { surveyResponses } from "../../evals/fixtures/samples/survey.ts";
import { isExcelExtensionInstalled } from "../../src/engines/duckdb/index.ts";
import {
  expectColumnTypes,
  openSampleSession,
  rowsToTotals,
  type SampleSession,
  totalsBy,
} from "./sample-kit.ts";

const needsExcel = !isExcelExtensionInstalled();
let session: SampleSession;

beforeEach(async () => {
  session = await openSampleSession();
});

afterEach(async () => {
  await session.test.cleanup();
});

describe("sales_2025.csv", () => {
  it("profiles 2,000 orders with blanks and a mixed column", async () => {
    const rows = salesRows();
    const profile = await session.inspect("sales_2025.csv");
    expect(profile).toContain(
      "Table sales_2025 (comma-separated): 2,000 rows x 8 columns, header row 1",
    );
    const notNumbers = rows.filter((row) => typeof row.discount_pct !== "number").length;
    const blankSegments = rows.filter((row) => row.customer_segment === "").length;
    expect(notNumbers).toBeGreaterThan(0);
    expect(blankSegments).toBeGreaterThan(0);
    expectColumnTypes(profile, {
      order_date: "date",
      units: "number",
      unit_price: "number",
      discount_pct: `mixed (${notNumbers} of ${salesRowCount} values are not numbers`,
      customer_segment: `text | ${blankSegments} |`,
    });
  });

  it("sums revenue by region", async () => {
    const expected = totalsBy(
      salesRows(),
      (row) => String(row.region),
      (row) => Number(row.units) * Number(row.unit_price),
    );
    await session.inspect("sales_2025.csv");
    const rows = await session.query(
      "SELECT region, sum(units * unit_price) AS revenue FROM sales_2025 GROUP BY region",
    );
    expect(rowsToTotals(rows, "region", "revenue")).toEqual(expected);
  });
});

describe("inventory.tsv", () => {
  it("finds the header under the two-line title and sums stock per warehouse", async () => {
    const profile = await session.inspect("inventory.tsv");
    expect(profile).toContain("Table inventory (tab-separated): 72 rows x 8 columns, header row 3");
    expectColumnTypes(profile, {
      sku: "text",
      on_hand: "number",
      unit_cost: "number",
      last_counted: "date",
    });
    const rows = await session.query(
      "SELECT warehouse, sum(on_hand) AS stock FROM inventory GROUP BY warehouse",
    );
    const expected = totalsBy(
      inventoryRows(),
      (row) => String(row.warehouse),
      (row) => Number(row.on_hand),
    );
    expect(rowsToTotals(rows, "warehouse", "stock")).toEqual(expected);
  });
});

describe.skipIf(needsExcel)("payroll_2025.xlsx (needs npm run vendor)", () => {
  it("profiles all three sheets with the roster header under a title block", async () => {
    const employees = payrollEmployees();
    const profile = await session.inspect("payroll_2025.xlsx");
    expect(profile).toContain("payroll_2025.xlsx: xlsx");
    expect(profile).toContain(
      `Table payroll_2025_employees (sheet "Employees"): ${employees.length} rows x 6 columns, header row 3`,
    );
    expect(profile).toContain(
      'Table payroll_2025_monthly (sheet "Monthly"): 60 rows x 4 columns, header row 1',
    );
    expect(profile).toContain('Table payroll_2025_notes (sheet "Notes"): 4 rows x 1 column');
    const earliestStart = employees.map((employee) => employee.startDate).sort()[0];
    expectColumnTypes(profile, {
      start_date: `date | 0 | ${new Set(employees.map((employee) => employee.startDate)).size} | ${earliestStart}`,
      annual_salary: "number",
      month: "text",
      headcount: "number",
      payroll_cost: "number",
    });
  });

  it("totals the year's payroll cost by department from the Monthly sheet", async () => {
    const expected = totalsBy(
      monthlyDepartmentCosts(payrollEmployees()),
      (cost) => cost.department,
      (cost) => cost.payrollCost,
    );
    await session.inspect("payroll_2025.xlsx");
    const rows = await session.query(
      "SELECT department, sum(payroll_cost) AS cost FROM payroll_2025_monthly GROUP BY department",
    );
    expect(rowsToTotals(rows, "department", "cost")).toEqual(expected);
  });
});

describe("budget_legacy.xls", () => {
  it("converts both sheets with exact dates", async () => {
    const lines = budgetLines();
    const profile = await session.inspect("budget_legacy.xls");
    expect(profile).toContain("budget_legacy.xls: xls");
    expect(profile).toContain(
      `Table budget_legacy_budget (sheet "Budget"): ${lines.length} rows x 5 columns, header row 1`,
    );
    expect(profile).toContain('Table budget_legacy_assumptions (sheet "Assumptions")');
    expectColumnTypes(profile, {
      period_start: "date | 0 | 12 | 2025-01-01 | 2025-12-01",
      budget: "number",
      actual: "number",
    });
    const months = await session.query(
      "SELECT DISTINCT CAST(period_start AS VARCHAR) AS month FROM budget_legacy_budget ORDER BY 1",
    );
    expect(months.map((row) => row.month)).toEqual([
      ...new Set(lines.map((line) => line.periodStart)),
    ]);
  });

  it("sums actual spend by department", async () => {
    const expected = totalsBy(
      budgetLines(),
      (line) => line.department,
      (line) => line.actual,
    );
    await session.inspect("budget_legacy.xls");
    const rows = await session.query(
      "SELECT department, sum(actual) AS spent FROM budget_legacy_budget GROUP BY department",
    );
    expect(rowsToTotals(rows, "department", "spent")).toEqual(expected);
  });
});

describe("board_report.docx", () => {
  it("lists the outline and four tables, the third with a header only", async () => {
    const profile = await session.inspect("board_report.docx");
    expect(profile).toContain("board_report.docx: docx");
    expect(profile).toContain("# Financial results\n# People\n## Headcount by office");
    expect(profile).toContain(
      'Table board_report_table_1 (table 1 under "Financial results"): 4 rows x 3 columns',
    );
    expect(profile).toContain(
      'Table board_report_table_2 (table 2 under "Headcount by office"): 5 rows x 3 columns, header row 1',
    );
    expect(profile).toContain('Table 3 under "Risk register": 0 rows x 0 columns');
    expect(profile).toContain("No data rows, not queryable");
    expectColumnTypes(profile, { Revenue: "number", Headcount: "number" });
  });

  it("makes the second table queryable for S9", async () => {
    await session.inspect("board_report.docx");
    const rows = await session.query(
      'SELECT sum(Headcount) AS people, max("Open roles") AS most_open FROM board_report_table_2',
    );
    const people = officeHeadcount.reduce((sum, [, headcount]) => sum + headcount, 0);
    const mostOpen = Math.max(...officeHeadcount.map(([, , open]) => open));
    expect(rows).toEqual([{ people, most_open: mostOpen }]);
    const revenue = await session.query("SELECT sum(Revenue) AS total FROM board_report_table_1");
    const totalRevenue = quarterlyRevenue.reduce((sum, [, amount]) => sum + amount, 0);
    expect(Number(revenue[0]?.total)).toBe(totalRevenue);
  });
});

describe.skipIf(needsExcel)("survey_export.csv (needs npm run vendor)", () => {
  it("is detected as .xlsx and counts promoters by channel", async () => {
    const responses = surveyResponses();
    const profile = await session.inspect("survey_export.csv");
    expect(profile).toContain("survey_export.csv: xlsx");
    expect(profile).toContain("Note: The file named .csv but its content is xlsx.");
    expectColumnTypes(profile, {
      submitted_on: "date",
      satisfaction: "number",
      would_recommend: "boolean",
      comment: `text | ${responses.filter((response) => response.comment === null).length} |`,
    });
    const rows = await session.query(
      "SELECT channel, count(*) FILTER (WHERE would_recommend) AS promoters FROM survey_export GROUP BY channel",
    );
    const expected = totalsBy(
      responses,
      (response) => response.channel,
      (response) => (response.wouldRecommend ? 1 : 0),
    );
    expect(rowsToTotals(rows, "channel", "promoters")).toEqual(expected);
  });
});
