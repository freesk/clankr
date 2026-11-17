// samples/payroll_2025.xlsx: an employee roster under a title block, monthly
// headcount and cost by department (long format, for a stacked bar), and notes.
// The Monthly sheet is derived from the roster, so the two always agree.

import { currencyCell, dateCell, type WorkbookSheet } from "../generators/spreadsheet.ts";
import { roundToCents, seededRandom } from "../seeded-random.ts";

export interface Employee {
  employeeId: string;
  name: string;
  department: string;
  jobTitle: string;
  /** ISO date. */
  startDate: string;
  annualSalary: number;
}

export interface MonthlyDepartmentCost {
  /** "2025-01" to "2025-12". */
  month: string;
  department: string;
  headcount: number;
  payrollCost: number;
}

export const payrollDepartments = ["Engineering", "Sales", "Support", "Finance", "Operations"];

const departmentPlans: Record<string, { size: number; title: string; baseSalary: number }> = {
  Engineering: { size: 16, title: "Software Engineer", baseSalary: 98_000 },
  Sales: { size: 11, title: "Account Executive", baseSalary: 64_000 },
  Support: { size: 9, title: "Support Specialist", baseSalary: 48_000 },
  Finance: { size: 5, title: "Financial Analyst", baseSalary: 72_000 },
  Operations: { size: 7, title: "Operations Coordinator", baseSalary: 55_000 },
};

const firstNames = ["Ada", "Bram", "Cleo", "Dario", "Esme", "Florin", "Greta", "Hollis", "Ines"];
const lastNames = ["Ashgrove", "Brightwater", "Coldbrook", "Dunmere", "Eastholt", "Fernvale"];

export function payrollEmployees(): Employee[] {
  const random = seededRandom(4242);
  const employees: Employee[] = [];
  for (const department of payrollDepartments) {
    const plan = departmentPlans[department];
    if (!plan) continue;
    for (let indexInDepartment = 0; indexInDepartment < plan.size; indexInDepartment++) {
      const number = employees.length + 1;
      // About a quarter of each team joined during 2025, so headcount grows month by month.
      const joinedThisYear = random.chance(0.25);
      const startYear = joinedThisYear ? 2025 : random.integer(2016, 2024);
      const startMonth = random.integer(1, 12);
      employees.push({
        employeeId: `E${String(number).padStart(3, "0")}`,
        name: `${firstNames[number % firstNames.length]} ${lastNames[(number * 5) % lastNames.length]}`,
        department,
        jobTitle: plan.title,
        startDate: `${startYear}-${String(startMonth).padStart(2, "0")}-${String(random.integer(1, 28)).padStart(2, "0")}`,
        annualSalary: plan.baseSalary + random.integer(0, 40) * 500,
      });
    }
  }
  return employees;
}

export const payrollMonths = Array.from(
  { length: 12 },
  (_, index) => `2025-${String(index + 1).padStart(2, "0")}`,
);

/** Everyone who started on or before the end of a month counts for that whole month. */
export function monthlyDepartmentCosts(employees: Employee[]): MonthlyDepartmentCost[] {
  const costs: MonthlyDepartmentCost[] = [];
  for (const month of payrollMonths) {
    for (const department of payrollDepartments) {
      const active = employees.filter(
        (employee) => employee.department === department && employee.startDate.slice(0, 7) <= month,
      );
      const monthlySalaries = active.reduce((sum, employee) => sum + employee.annualSalary / 12, 0);
      costs.push({
        month,
        department,
        headcount: active.length,
        payrollCost: roundToCents(monthlySalaries),
      });
    }
  }
  return costs;
}

export const payrollNotes = [
  "All names, salaries, and dates in this workbook are fictional.",
  "Monthly counts everyone whose start date falls on or before the end of the month.",
  "payroll_cost is the sum of annual salaries divided by 12, in US dollars.",
  "Nobody left the company in 2025.",
];

export function payrollSheets(): WorkbookSheet[] {
  const employees = payrollEmployees();
  return [
    {
      name: "Employees",
      rows: [
        ["Bramblewood Outfitters - employee roster (fictional)"],
        [],
        ["employee_id", "name", "department", "job_title", "start_date", "annual_salary"],
        ...employees.map((employee) => [
          employee.employeeId,
          employee.name,
          employee.department,
          employee.jobTitle,
          dateCell(employee.startDate),
          currencyCell(employee.annualSalary),
        ]),
      ],
    },
    {
      name: "Monthly",
      rows: [
        ["month", "department", "headcount", "payroll_cost"],
        ...monthlyDepartmentCosts(employees).map((cost) => [
          cost.month,
          cost.department,
          cost.headcount,
          currencyCell(cost.payrollCost),
        ]),
      ],
    },
    { name: "Notes", rows: [["note"], ...payrollNotes.map((note) => [note])] },
  ];
}
