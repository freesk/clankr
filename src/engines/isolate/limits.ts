// The isolate's limits, built from config in one place so `run_js` and `make_chart` share
// one set of numbers (specs/sandbox.md). Pure: importing it never loads `isolated-vm`.

import type { Config } from "../../config/schema.ts";
import type { IsolateLimits } from "../../contracts/index.ts";

export function isolateLimitsFrom(config: Config): IsolateLimits {
  return {
    timeoutMs: config.data.isolateTimeoutMs,
    memoryLimitMb: config.data.isolateMemoryLimitMb,
    rowCap: config.data.rowCap,
  };
}
