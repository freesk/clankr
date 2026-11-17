// The committed sample files under samples/, each rendered in memory from the
// seeded data in this folder. `npm run samples` writes them; the samples test
// checks that the committed bytes still match.

import { renderDocxBlocks } from "../generators/docx.ts";
import { delimitedText, renderWorkbook } from "../generators/spreadsheet.ts";
import { boardReportBlocks } from "./board-report.ts";
import { budgetSheets } from "./budget-legacy.ts";
import { inventoryColumns, inventoryRows, inventoryTitleLines } from "./inventory.ts";
import { payrollSheets } from "./payroll-2025.ts";
import { salesColumns, salesRows } from "./sales-2025.ts";
import { surveySheets } from "./survey.ts";

export interface SampleFile {
  /** File name inside samples/. */
  name: string;
  render(): Buffer;
}

export const sampleFiles: SampleFile[] = [
  {
    name: "sales_2025.csv",
    render: () =>
      Buffer.from(delimitedText({ columns: salesColumns, rows: salesRows(), delimiter: "," })),
  },
  {
    name: "inventory.tsv",
    render: () =>
      Buffer.from(
        delimitedText({
          preamble: inventoryTitleLines,
          columns: inventoryColumns,
          rows: inventoryRows(),
          delimiter: "\t",
        }),
      ),
  },
  { name: "payroll_2025.xlsx", render: () => renderWorkbook(payrollSheets(), "xlsx") },
  { name: "budget_legacy.xls", render: () => renderWorkbook(budgetSheets(), "xls") },
  { name: "board_report.docx", render: () => renderDocxBlocks(boardReportBlocks()) },
  // An .xlsx under a .csv name on purpose: inspection must trust the content, not the name.
  { name: "survey_export.csv", render: () => renderWorkbook(surveySheets(), "xlsx") },
];
