// pdf part. See specs/pdf.md. Turns a validated Vega-Lite spec into a PDF, PNG, or SVG file,
// and a row set into a PDF table, in an offline headless browser. Playwright is loaded lazily,
// on the first render.

export {
  type ChartRenderer,
  type ChartRendererOptions,
  chartDataName,
  createChartRenderer,
  exportScale,
  withHarnessData,
} from "./chart-renderer.ts";
export { systemFontFamily } from "./fonts.ts";
export type { BlockedRequest, BlockedRequestLogger } from "./offline.ts";
export { ChartDrawError } from "./page-calls.ts";
export { orientedPageMillimetres } from "./page-layout.ts";
export type { ReportBlock } from "./report.ts";
export {
  assertVendored,
  isBrowserVendored,
  MissingVendorFileError,
  vegaLiteSchemaPath,
} from "./vendor-files.ts";
