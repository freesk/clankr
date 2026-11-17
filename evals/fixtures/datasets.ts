// Synthetic datasets for the data tasks. Every value is derived from the row
// index by a simple rule, so the expected answers in the golden tasks can be
// checked without the model (see datasets.test.ts). No real data, ever.

export type CellValue = string | number;
export type DataRow = Record<string, CellValue>;

export interface Dataset {
  columns: string[];
  /** Rows are produced lazily so the 1,000,000-row file never sits in memory. */
  rows(count?: number): Iterable<DataRow>;
  defaultRowCount: number;
}

const departments = ["Engineering", "Sales", "Finance", "Operations"] as const;
const employeesPerDepartment = [10, 6, 4, 4] as const;
const baseSalaryPerDepartment = [90_000, 60_000, 70_000, 50_000] as const;
const firstNames = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Jordan"];
const lastNames = ["Alder", "Birch", "Cedar", "Dogwood", "Elm", "Fir"];

function* payrollRows(): Iterable<DataRow> {
  let employeeNumber = 0;
  for (const [departmentIndex, department] of departments.entries()) {
    const employeeCount = employeesPerDepartment[departmentIndex] ?? 0;
    const baseSalary = baseSalaryPerDepartment[departmentIndex] ?? 0;
    for (let indexInDepartment = 0; indexInDepartment < employeeCount; indexInDepartment++) {
      employeeNumber++;
      yield {
        employee_id: `E${String(employeeNumber).padStart(3, "0")}`,
        name: `${firstNames[employeeNumber % firstNames.length]} ${lastNames[employeeNumber % lastNames.length]}`,
        department,
        start_date: `20${String(15 + (employeeNumber % 10)).padStart(2, "0")}-0${1 + (employeeNumber % 9)}-15`,
        annual_salary: baseSalary + indexInDepartment * 1_000,
      };
    }
  }
}

const months = Array.from(
  { length: 12 },
  (_, index) => `2025-${String(index + 1).padStart(2, "0")}`,
);

/** Engineering grows by one a month; the others follow fixed patterns. */
export function headcountFor(department: string, monthIndex: number): number {
  switch (department) {
    case "Engineering":
      return 40 + monthIndex;
    case "Sales":
      return 20 + (monthIndex % 3);
    case "Finance":
      return 8;
    default:
      return 12 - Math.floor(monthIndex / 4);
  }
}

function* headcountRows(): Iterable<DataRow> {
  for (const [monthIndex, month] of months.entries()) {
    for (const department of departments) {
      yield { month, department, headcount: headcountFor(department, monthIndex) };
    }
  }
}

export const salesRegions = ["North", "South", "East", "West"] as const;
export const salesProducts = ["Widget", "Gadget", "Gizmo"] as const;
export const unitPrices: Record<(typeof salesProducts)[number], number> = {
  Widget: 2.5,
  Gadget: 10,
  Gizmo: 4,
};
const millisecondsPerDay = 86_400_000;
const firstSalesDay = Date.UTC(2025, 0, 1);

function salesRow(index: number): DataRow {
  const product = salesProducts[index % salesProducts.length] ?? "Widget";
  return {
    order_id: index + 1,
    order_date: new Date(firstSalesDay + (index % 365) * millisecondsPerDay)
      .toISOString()
      .slice(0, 10),
    region: salesRegions[index % salesRegions.length] ?? "North",
    product,
    quantity: (index % 5) + 1,
    unit_price: unitPrices[product],
  };
}

function* salesRows(count: number): Iterable<DataRow> {
  for (let index = 0; index < count; index++) yield salesRow(index);
}

export const datasets = {
  payroll: {
    columns: ["employee_id", "name", "department", "start_date", "annual_salary"],
    rows: () => payrollRows(),
    defaultRowCount: 24,
  },
  headcount: {
    columns: ["month", "department", "headcount"],
    rows: () => headcountRows(),
    defaultRowCount: 48,
  },
  sales: {
    columns: ["order_id", "order_date", "region", "product", "quantity", "unit_price"],
    rows: (count = 1_000) => salesRows(count),
    defaultRowCount: 1_000,
  },
} satisfies Record<string, Dataset>;

export type DatasetName = keyof typeof datasets;
export const datasetNames = Object.keys(datasets) as DatasetName[];

/** The S9 board report: the second table is the one tasks ask to plot. */
export const boardReport = {
  title: "Board Report Q4 2025",
  paragraphs: [
    "This synthetic report summarises the fictional company's year.",
    "Revenue grew in every quarter. Headcount by office follows below.",
  ],
  tables: [
    {
      caption: "Revenue by quarter",
      header: ["Quarter", "Revenue"],
      rows: [
        ["Q1", "1200000"],
        ["Q2", "1350000"],
        ["Q3", "1410000"],
        ["Q4", "1580000"],
      ],
    },
    {
      caption: "Headcount by office",
      header: ["Office", "Headcount"],
      rows: [
        ["Berlin", "42"],
        ["Lisbon", "31"],
        ["Austin", "57"],
        ["Osaka", "24"],
      ],
    },
  ],
};
