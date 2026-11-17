// Data files and chart rendering (seams: inspect → sql, sandbox, chart; chart → pdf).

import type { OutputFormat } from "./output.ts";
import type { ResultHandle, Row } from "./results.ts";

export type DataFormat = "xlsx" | "xls" | "csv" | "tsv" | "docx";

/** A sheet, a delimited file, or a table found in a document, exposed to SQL as one table. */
export interface DataTable {
  /** SQL table name, for example "payroll_2025_sheet1". */
  sqlName: string;
  /** Sheet or table label as the user would recognise it. */
  label: string;
  /** Set when the table's rows were extracted into a stored row set (`.docx`, `.xls`). */
  rowsHandle?: ResultHandle;
  /** Where the table sits in its file, so SQL reads it the way inspection did. Absent for row sets. */
  layout?: TableLayout;
}

/** How to read a sheet or delimited file: the header row inspection detected or was told. */
export interface TableLayout {
  /** 1-based row of the header line. */
  headerRow: number;
  /** Sheet name, for `.xlsx`. */
  sheet?: string;
  /** Cell range for `.xlsx`, from the header row to the last used cell, for example "A3:F1200". */
  cellRange?: string;
  /** Field delimiter, for `.csv` and `.tsv`. */
  delimiter?: string;
  /**
   * A UTF-8 copy in the session's scratch folder, for a delimited file that is not UTF-8.
   * DuckDB reads the copy instead of the original.
   */
  utf8CopyPath?: string;
  /** Guess column types from every row: set when a value far down the file broke the guess. */
  scanAllRowsForTypes?: boolean;
}

export interface DataSource {
  /** Handle of the stored profile. */
  handle: ResultHandle;
  realPath: string;
  format: DataFormat;
  tables: DataTable[];
}

export interface DataSourceRegistry {
  register(source: DataSource): void;
  /** Look up by profile handle or by real path. */
  find(handleOrPath: string): DataSource | undefined;
  /** Which data source owns a SQL table name. */
  findByTable(sqlName: string): DataSource | undefined;
  list(): DataSource[];
}

export type PageSize = "A4" | "Letter";

/** `~/.clankr/theme.json` (DATA-15). Chart applies palette and fonts; pdf applies the page. */
export interface Theme {
  palette: string[];
  fontFamily: string;
  page: { size: PageSize; orientation: "portrait" | "landscape" };
  logoPath?: string;
  footer?: string;
}

/** The formats the offline browser draws itself. Word and Excel files are written by output. */
export type ChartFormat = Extract<OutputFormat, "pdf" | "png" | "svg">;

export interface ChartRenderRequest {
  /** A Vega-Lite spec that already passed schema validation and theming. */
  spec: Record<string, unknown>;
  rows: Row[];
  theme: Theme;
  format: ChartFormat;
  outputPath: string;
  /** Plain text printed under the chart in a PDF: what the chart shows. Ignored for PNG and SVG. */
  summary?: string;
}

/** One chart of a multi-chart PDF: a validated, themed spec, its rows, and its summary. */
export interface ChartPage {
  spec: Record<string, unknown>;
  rows: Row[];
  summary?: string;
}

/** Several charts in one portrait PDF, one chart per page, each with its summary under it. */
export interface ChartPagesRequest {
  charts: ChartPage[];
  theme: Theme;
  outputPath: string;
}

/** A row set printed as a paginated table in a PDF (`export_table`). Cells arrive as text. */
export interface TableRenderRequest {
  /** Printed above the table. */
  title?: string;
  columns: string[];
  /** One array per row, in column order. */
  cells: string[][];
  /** Whether each column, in order, holds numbers; those are right-aligned. */
  numericColumns: boolean[];
  theme: Theme;
  outputPath: string;
}

export interface ChartRenderResult {
  path: string;
  sizeBytes: number;
  /** Pages in a written PDF. */
  pageCount?: number;
  /** Things the model or user should know: a replaced font, a left-out logo, Vega warnings. */
  notes?: string[];
}
