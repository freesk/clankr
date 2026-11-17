// Reproducibility (DATA-20): the chart code, the final spec, and the SQL that produced the rows
// are saved next to the chart, so it can be redrawn without the model.

import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ChartOutputPaths } from "./output-naming.ts";
import type { RowSources } from "./provenance.ts";

/** Writes the companion files and returns the names written. Never overwrites (D28). */
export async function writeCompanionFiles(
  paths: ChartOutputPaths,
  code: string,
  specs: Record<string, unknown>[],
  sources: RowSources,
): Promise<string[]> {
  const written: string[] = [];
  await writeFile(paths.code, `${code.trimEnd()}\n`, { flag: "wx" });
  written.push(basename(paths.code));
  // One file per chart, so each is a spec Vega-Lite can draw on its own. Summaries are in the code.
  for (const [index, specPath] of paths.specs.entries()) {
    await writeFile(specPath, `${JSON.stringify(specs[index], null, 2)}\n`, { flag: "wx" });
    written.push(basename(specPath));
  }
  if (sources.sql.length > 0) {
    await writeFile(paths.sql, sqlFileText(sources), { flag: "wx" });
    written.push(basename(paths.sql));
  }
  return written;
}

function sqlFileText(sources: RowSources): string {
  const header = sources.dataFiles.map((file) => `-- Data file: ${file}`);
  const statements = sources.sql.map((statement) => `${statement.trim().replace(/;$/, "")};`);
  return `${[...header, ...statements].join("\n\n")}\n`;
}
