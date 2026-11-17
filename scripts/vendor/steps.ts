// Every vendoring step, in install order. Each part appends its own:
// search (ripgrep), sql (DuckDB Excel extension), chart (Vega-Lite), pdf (Chromium).

import { ripgrepStep } from "./ripgrep.ts";
import type { VendorStep } from "./step.ts";

export const vendorSteps: VendorStep[] = [ripgrepStep];
