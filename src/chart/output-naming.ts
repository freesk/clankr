// Where a chart is written and what it is called (D28): next to the data file, named from
// the chart title, with a number appended when the name is taken. Nothing is overwritten,
// and the DATA-20 companion files share the chart's base name, so they are checked too.

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { ChartFormat } from "../contracts/index.ts";
import { isPlainObject } from "./spec-tree.ts";

export interface ChartOutputPaths {
  chart: string;
  code: string;
  spec: string;
  sql: string;
  format: ChartFormat;
}

const chartFormats: ChartFormat[] = ["pdf", "png", "svg"];
const maxNameLength = 60;
const maxNumberedAttempts = 999;

/** A file-name-safe base name from the spec's title, or "chart" when it has none. */
export function baseNameFromTitle(spec: unknown): string {
  const title = titleText(spec);
  const slug = title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, maxNameLength)
    .replace(/-+$/, "");
  return slug || "chart";
}

export function titleText(spec: unknown): string {
  if (!isPlainObject(spec)) return "";
  const title = isPlainObject(spec.title) ? spec.title.text : spec.title;
  if (typeof title === "string") return title;
  if (Array.isArray(title)) return title.filter((line) => typeof line === "string").join(" ");
  return "";
}

/** The format an explicit output path asks for by its extension, if it names one. */
export function formatFromPath(path: string): ChartFormat | undefined {
  const extension = extname(path).slice(1).toLowerCase();
  return chartFormats.find((format) => format === extension);
}

/** `~` is the home folder; relative paths resolve against the working directory. */
export function resolveUserPath(path: string, workingDirectory: string): string {
  if (path === "~" || path.startsWith("~/")) return join(homedir(), path.slice(1));
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

/** Picks the first free name: "sales", then "sales-2", "sales-3", and so on. */
export async function chooseOutputPaths(
  folder: string,
  baseName: string,
  format: ChartFormat,
): Promise<ChartOutputPaths> {
  for (let number = 1; number <= maxNumberedAttempts; number++) {
    const name = number === 1 ? baseName : `${baseName}-${number}`;
    const paths = pathsFor(folder, name, format);
    if (!(await anyExists([paths.chart, paths.code, paths.spec, paths.sql]))) return paths;
  }
  throw new Error(`No free file name for ${baseName} in ${folder}`);
}

/** Base name and folder from an explicit output path, which also gets a number if taken. */
export function splitOutputPath(path: string): { folder: string; baseName: string } {
  const extension = formatFromPath(path) ? extname(path) : "";
  return { folder: resolve(path, ".."), baseName: basename(path, extension) };
}

function pathsFor(folder: string, name: string, format: ChartFormat): ChartOutputPaths {
  return {
    chart: join(folder, `${name}.${format}`),
    code: join(folder, `${name}.chart.js`),
    spec: join(folder, `${name}.vl.json`),
    sql: join(folder, `${name}.sql`),
    format,
  };
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      await access(path);
      return true;
    } catch {
      // Not there, which is what we want.
    }
  }
  return false;
}
