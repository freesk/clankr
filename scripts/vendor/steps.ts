// Every vendoring step, in install order. Each part appends its own:
// search (ripgrep), sql (DuckDB Excel extension), chart (Vega-Lite), pdf (Chromium).

import { duckDbExcelStep } from "./duckdb-excel.ts";
import type { VendorStep } from "./step.ts";

export const vendorSteps: VendorStep[] = [duckDbExcelStep];
