// The profile text: the model's whole picture of a data file (PRD principle 4). One
// compact table per sheet or table, one line per column, with the DATA-2 fields, and
// the exact SQL table name to use. Wide sheets show their first columns and point to
// the full profile in the result store.

import { basename } from "node:path";
import type { DataFormat } from "../../../contracts/index.ts";
import type { ColumnProfile } from "./column-profile.ts";
import type { DocxHeading } from "./docx-document.ts";
import type { RowGrain } from "./row-grain.ts";

export interface TableProfile {
  /** Absent when the table has no data rows and so was not registered. */
  sqlName?: string;
  /** For example `sheet "Plan"` or `table 2 under "Q3 results"`. */
  description: string;
  headerRow?: number;
  rowCount: number;
  columns: ColumnProfile[];
  /** What one row stands for, when the table is a time series by some category. */
  grain?: RowGrain;
}

export interface FileProfile {
  realPath: string;
  format: DataFormat;
  sizeBytes: number;
  mismatchNote?: string;
  headings?: DocxHeading[];
  tables: TableProfile[];
}

export interface FormatOptions {
  /** Columns shown per table; undefined shows all. */
  columnsShown?: number;
  /** Lower-cased column names whose values are masked (DATA-5). */
  sensitiveColumns: Set<string>;
  profileHandle?: string;
}

const maximumValueLength = 30;
const maximumHeadingsShown = 40;
const masked = "(masked)";

export function formatProfile(profile: FileProfile, options: FormatOptions): string {
  const lines = [summaryLine(profile, options.profileHandle)];
  if (profile.mismatchNote) lines.push(`Note: ${profile.mismatchNote}`);
  if (profile.headings) lines.push(...outlineLines(profile.headings, options));
  for (const table of profile.tables) lines.push("", ...tableLines(table, options));
  if (profile.tables.length === 0) lines.push("", "No tables with data were found.");
  return lines.join("\n");
}

function summaryLine(profile: FileProfile, profileHandle: string | undefined): string {
  const parts = [
    `${basename(profile.realPath)}: ${profile.format}`,
    formatBytes(profile.sizeBytes),
  ];
  const tableNoun = profile.format === "docx" ? "table" : "sheet";
  if (profile.format !== "csv" && profile.format !== "tsv") {
    parts.push(plural(profile.tables.length, tableNoun));
  }
  const stored = profileHandle ? ` Full profile: ${profileHandle}.` : "";
  return `${parts.join(", ")}.${stored} Query with query_sql using the table names below.`;
}

function outlineLines(headings: DocxHeading[], options: FormatOptions): string[] {
  if (headings.length === 0) return ["Outline: no headings."];
  const shown =
    options.columnsShown === undefined ? headings : headings.slice(0, maximumHeadingsShown);
  const lines = [
    "Outline:",
    ...shown.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`),
  ];
  if (shown.length < headings.length) {
    lines.push(`(${headings.length - shown.length} more headings in the full profile)`);
  }
  return lines;
}

function tableLines(table: TableProfile, options: FormatOptions): string[] {
  const size = `${plural(table.rowCount, "row")} x ${plural(table.columns.length, "column")}`;
  const header = table.headerRow === undefined ? "" : `, header row ${table.headerRow}`;
  if (!table.sqlName)
    return [`${capitalize(table.description)}: ${size}${header}. No data rows, not queryable.`];
  const lines = [`Table ${table.sqlName} (${table.description}): ${size}${header}`];
  const shownColumns =
    options.columnsShown === undefined
      ? table.columns
      : table.columns.slice(0, options.columnsShown);
  lines.push("column | type | nulls | distinct | min | max | samples");
  for (const column of shownColumns) lines.push(columnLine(column, options.sensitiveColumns));
  const hidden = table.columns.length - shownColumns.length;
  if (hidden > 0) {
    const where = options.profileHandle
      ? ` Read ${options.profileHandle} with read_result for them.`
      : "";
    lines.push(`(${hidden} more columns not shown.${where})`);
  }
  const repeated = repeatedIdentifierNote(table);
  if (repeated) lines.push(repeated);
  if (table.grain) lines.push(grainNote(table.grain));
  return lines;
}

/**
 * Tells the model what one row is, and that totals per a coarser group need a SUM per group
 * and time first. Averaging the rows directly gives a per-row figure.
 */
function grainNote(grain: RowGrain): string {
  const groups = grain.groupingColumns.slice(0, 2).map((name) => `"${name}"`);
  const coarser =
    groups.length > 0
      ? ` ${groups.join(" and ")} cover several rows per "${grain.timeColumn}".`
      : "";
  return (
    `Note: each row is about one "${grain.keyColumn}" per "${grain.timeColumn}".${coarser} ` +
    `For a figure per group and "${grain.timeColumn}" (per city per day), SUM within the group and ` +
    `"${grain.timeColumn}" first, then average those totals.`
  );
}

/** Names that usually identify one thing: "Authorization Number", "employee_id", "EMP_KEY". */
const identifierName = /(^|[\s_])(id|number|no|num|key|code|uid)$/i;

/**
 * Says when an identifier repeats across rows, with the SQL that counts the things it names.
 * A small model counted rows as licences (151,322 for 6,115 licences) even when the chart
 * reference told it otherwise; the profile is what it reads right before writing SQL.
 */
function repeatedIdentifierNote(table: TableProfile): string | undefined {
  const repeated = table.columns.find(
    (column) =>
      identifierName.test(column.name.trim()) &&
      column.distinctCount >= 100 &&
      column.distinctCount < (table.rowCount - column.nullCount) * 0.9,
  );
  if (!repeated) return undefined;
  const distinct = `${repeated.distinctApproximate ? "about " : ""}${repeated.distinctCount.toLocaleString("en-US")}`;
  return (
    `Note: several rows share each "${repeated.name}" (${distinct} distinct in ` +
    `${table.rowCount.toLocaleString("en-US")} rows). To count them, use ` +
    `COUNT(DISTINCT "${repeated.name}"), not COUNT(*).`
  );
}

function columnLine(column: ColumnProfile, sensitiveColumns: Set<string>): string {
  const isMasked = sensitiveColumns.has(column.name.toLowerCase());
  const show = (value: string | null) => (isMasked && value !== null ? masked : shorten(value));
  const type = column.type === "other" ? column.sqlType.toLowerCase() : column.type;
  const distinct = `${column.distinctApproximate ? "~" : ""}${column.distinctCount}`;
  const samples = isMasked ? masked : column.samples.map((value) => shorten(value)).join("; ");
  const typeText = column.note ? `${type} (${column.note})` : type;
  return [
    column.name,
    typeText,
    column.nullCount,
    distinct,
    show(column.min),
    show(column.max),
    samples,
  ].join(" | ");
}

function shorten(value: string | null): string {
  if (value === null) return "";
  const oneLine = value.replace(/\s+/g, " ");
  return oneLine.length <= maximumValueLength
    ? oneLine
    : `${oneLine.slice(0, maximumValueLength)}…`;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
