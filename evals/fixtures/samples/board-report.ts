// samples/board_report.docx: a short board report with a heading outline and four
// tables. The second table (headcount by office) is the one S9 asks to plot; the
// third has a header and no rows.

import type { DocxBlock } from "../generators/docx.ts";

export interface ReportTable {
  header: string[];
  rows: string[][];
}

const formatThousands = (amount: number): string => amount.toLocaleString("en-US");

export const quarterlyRevenue: [string, number, number][] = [
  ["Q1", 1_240_000, 1_010_000],
  ["Q2", 1_385_500, 1_090_250],
  ["Q3", 1_462_000, 1_118_400],
  ["Q4", 1_731_250, 1_244_900],
];

export const officeHeadcount: [string, number, number][] = [
  ["Lisbon", 38, 4],
  ["Austin", 52, 7],
  ["Osaka", 21, 2],
  ["Nairobi", 17, 5],
  ["Toronto", 29, 3],
];

export const reportTables: ReportTable[] = [
  {
    header: ["Quarter", "Revenue", "Operating cost"],
    rows: quarterlyRevenue.map(([quarter, revenue, cost]) => [
      quarter,
      formatThousands(revenue),
      formatThousands(cost),
    ]),
  },
  {
    header: ["Office", "Headcount", "Open roles"],
    rows: officeHeadcount.map(([office, headcount, open]) => [
      office,
      String(headcount),
      String(open),
    ]),
  },
  { header: ["Risk", "Owner", "Status"], rows: [] },
  {
    header: ["Product", "Units sold", "Return rate"],
    rows: [
      ["Rain Shell", "4,820", "3.1%"],
      ["Trail Lantern", "9,145", "1.2%"],
      ["Folding Stool", "3,377", "n/a"],
    ],
  },
];

function table(index: number): DocxBlock {
  const content = reportTables[index];
  if (!content) throw new Error(`No report table ${index}`);
  return { kind: "table", ...content };
}

export function boardReportBlocks(): DocxBlock[] {
  return [
    { kind: "title", text: "Bramblewood Outfitters - Board Report FY2025" },
    {
      kind: "paragraph",
      text: "Prepared for the board meeting of 2026-01-20. All figures are fictional.",
    },
    { kind: "heading", level: 1, text: "Financial results" },
    { kind: "paragraph", text: "Revenue grew every quarter, led by the autumn range." },
    table(0),
    { kind: "heading", level: 1, text: "People" },
    { kind: "heading", level: 2, text: "Headcount by office" },
    { kind: "paragraph", text: "Austin remains the largest office; Nairobi opened in March." },
    table(1),
    { kind: "heading", level: 1, text: "Risk register" },
    {
      kind: "paragraph",
      text: "No open risks were recorded this year. The table is kept for the template.",
    },
    table(2),
    { kind: "heading", level: 1, text: "Products" },
    { kind: "heading", level: 2, text: "Best sellers" },
    table(3),
  ];
}
