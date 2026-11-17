// Data files and chart rendering (seams: inspect → sql, sandbox, chart; chart → pdf).

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

/** `~/.vix/theme.json` (DATA-15). Chart applies palette and fonts; pdf applies the page. */
export interface Theme {
  palette: string[];
  fontFamily: string;
  page: { size: PageSize; orientation: "portrait" | "landscape" };
  logoPath?: string;
  footer?: string;
}

export type ChartFormat = "pdf" | "png" | "svg";

export interface ChartRenderRequest {
  /** A Vega-Lite spec that already passed schema validation and theming. */
  spec: Record<string, unknown>;
  rows: Row[];
  theme: Theme;
  format: ChartFormat;
  outputPath: string;
}

export interface ChartRenderResult {
  path: string;
  sizeBytes: number;
}
