// What a chart's files are called (D28): next to the data file, named from the chart title,
// with a number appended when the name is taken. The DATA-20 companion files share the chart's
// base name, so they are checked too. The naming rules themselves are in src/output/naming.ts.

import { join } from "node:path";
import type { OutputFormat } from "../contracts/index.ts";
import { firstFreeName, slugFromTitle } from "../output/naming.ts";
import { isPlainObject } from "./spec-tree.ts";

export interface ChartOutputPaths {
  chart: string;
  code: string;
  /** One spec file per chart: `name.vl.json`, or `name.1.vl.json`, `name.2.vl.json`, ... */
  specs: string[];
  sql: string;
  format: OutputFormat;
}

/** A file-name-safe base name from the spec's title, or "chart" when it has none. */
export function baseNameFromTitle(spec: unknown): string {
  return slugFromTitle(titleText(spec), "chart");
}

export function titleText(spec: unknown): string {
  if (!isPlainObject(spec)) return "";
  const title = isPlainObject(spec.title) ? spec.title.text : spec.title;
  if (typeof title === "string") return title;
  if (Array.isArray(title)) return title.filter((line) => typeof line === "string").join(" ");
  return "";
}

/** Picks the first name under which neither the chart nor a companion file exists. */
export async function chooseOutputPaths(
  folder: string,
  baseName: string,
  format: OutputFormat,
  chartCount = 1,
): Promise<ChartOutputPaths> {
  const allPaths = (name: string) => {
    const paths = pathsFor(folder, name, format, chartCount);
    return [paths.chart, paths.code, ...paths.specs, paths.sql];
  };
  const name = await firstFreeName(folder, baseName, allPaths);
  return pathsFor(folder, name, format, chartCount);
}

function pathsFor(
  folder: string,
  name: string,
  format: OutputFormat,
  chartCount: number,
): ChartOutputPaths {
  const specs =
    chartCount === 1
      ? [join(folder, `${name}.vl.json`)]
      : Array.from({ length: chartCount }, (_, index) =>
          join(folder, `${name}.${index + 1}.vl.json`),
        );
  return {
    chart: join(folder, `${name}.${format}`),
    code: join(folder, `${name}.chart.js`),
    specs,
    sql: join(folder, `${name}.sql`),
    format,
  };
}
