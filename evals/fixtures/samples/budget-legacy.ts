// samples/budget_legacy.xls: a legacy BIFF8 workbook with budget and actual spend
// per month, department, and line item, plus an assumptions sheet. The date column
// exercises the exact-date conversion for .xls (D36).

import { currencyCell, dateCell, type WorkbookSheet } from "../generators/spreadsheet.ts";
import { roundToCents, seededRandom } from "../seeded-random.ts";

export interface BudgetLine {
  /** ISO date, the first day of the month. */
  periodStart: string;
  department: string;
  lineItem: string;
  budget: number;
  actual: number;
}

export const budgetDepartments = ["Engineering", "Sales", "Support", "Operations"];
export const budgetLineItems = ["Salaries", "Travel", "Software", "Equipment"];

const monthlyBudget: Record<string, number> = {
  Salaries: 60_000,
  Travel: 4_000,
  Software: 6_500,
  Equipment: 3_000,
};

export function budgetLines(): BudgetLine[] {
  const random = seededRandom(1998);
  const lines: BudgetLine[] = [];
  for (let month = 1; month <= 12; month++) {
    for (const department of budgetDepartments) {
      for (const lineItem of budgetLineItems) {
        const budget = monthlyBudget[lineItem] ?? 0;
        // Actual spend lands within 15% either side of the budget.
        const actual = roundToCents(budget * (0.85 + random.integer(0, 3_000) / 10_000));
        lines.push({
          periodStart: `2025-${String(month).padStart(2, "0")}-01`,
          department,
          lineItem,
          budget,
          actual,
        });
      }
    }
  }
  return lines;
}

export const budgetAssumptions: [string, string | number][] = [
  ["Fiscal year", "2025"],
  ["Currency", "USD"],
  ["Inflation allowance (%)", 3.5],
  ["Prepared by", "Finance (fictional)"],
];

export function budgetSheets(): WorkbookSheet[] {
  return [
    {
      name: "Budget",
      rows: [
        ["period_start", "department", "line_item", "budget", "actual"],
        ...budgetLines().map((line) => [
          dateCell(line.periodStart),
          line.department,
          line.lineItem,
          currencyCell(line.budget),
          currencyCell(line.actual),
        ]),
      ],
    },
    { name: "Assumptions", rows: [["assumption", "value"], ...budgetAssumptions] },
  ];
}
