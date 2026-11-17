// Perf helper, run as its own process by perf.test.ts so its peak memory is measured
// alone: inspects one file and prints the elapsed time and the process's peak RSS.
// Usage: node src/tools/data/inspect/perf/profile-once.ts <file>

import { SessionDataSourceRegistry } from "../../../../data/index.ts";
import { createSqlTestContext } from "../../../../engines/duckdb/testing/sql-test-context.ts";
import { inspectDataTool } from "../inspect-data.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: profile-once.ts <file>");

const test = await createSqlTestContext({ dataSources: new SessionDataSourceRegistry() });
try {
  const started = performance.now();
  const output = await inspectDataTool.run({ path }, test.context);
  const elapsedMs = Math.round(performance.now() - started);
  const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(JSON.stringify({ elapsedMs, peakRssMb, firstLine: output.text.split("\n")[2] }));
} finally {
  await test.cleanup();
}
