// Every vendoring step, in install order. Each part appends its own:
// search (ripgrep), sql (DuckDB Excel extension), chart (Vega-Lite), pdf (Chromium).

import { chromiumStep } from "./chromium.ts";
import { duckDbExcelStep } from "./duckdb-excel.ts";
import { ripgrepStep } from "./ripgrep.ts";
import type { VendorStep } from "./step.ts";
import { vegaStep } from "./vega.ts";

export const vendorSteps: VendorStep[] = [ripgrepStep, duckDbExcelStep, vegaStep, chromiumStep];
