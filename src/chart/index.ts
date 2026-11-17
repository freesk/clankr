// chart part. See specs/chart.md. Turns model-written chart code into a validated, themed
// Vega-Lite spec. The make_chart tool itself is in src/tools/data/make-chart.ts.

export {
  type CapturedChart,
  type CapturedCharts,
  maxChartsPerCall,
  runChartCode,
} from "./chart-code.ts";
export { maxSummaryCharacters } from "./chart-summary.ts";
export { defaultTheme } from "./default-theme.ts";
export {
  type PreparedChart,
  type PreparedChartPage,
  prepareChartSpec,
  prepareCharts,
} from "./prepare-spec.ts";
export { chartReferenceText, chartToolReference } from "./reference-text.ts";
export {
  createVisionSelfCheck,
  parseVerdict,
  type SelfCheck,
  type SelfCheckVerdict,
} from "./self-check.ts";
export { type LoadedTheme, loadTheme } from "./theme-loader.ts";
