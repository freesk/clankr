// Writes a task's fixtures into its working directory and remembers what each
// file looked like, for the file-unchanged assertion.

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Fixture, GeneratedFixture } from "../tasks/schema.ts";
import { docxOptions, renderDocx } from "./generators/docx.ts";
import { pdfOptions, renderPdf } from "./generators/pdf.ts";
import {
  pngShapeOptions,
  pngTextOptions,
  renderShapePng,
  renderTextPng,
} from "./generators/png.ts";
import { renderXlsx, type TableOptions, tableOptions, writeCsv } from "./generators/spreadsheet.ts";

/** Path relative to the working directory → SHA-256 of the content it was given. */
export type FixtureSnapshot = Map<string, string>;

/** CSV files at or above this size are generated once into the cache and copied. */
const cachedCsvRowThreshold = 100_000;

export const defaultFixtureCacheDirectory = join(tmpdir(), "vix-evals-fixtures");

export interface MaterializeOptions {
  cacheDirectory?: string;
}

export async function materializeFixtures(
  workingDirectory: string,
  fixtures: Fixture[],
  options: MaterializeOptions = {},
): Promise<FixtureSnapshot> {
  const snapshot: FixtureSnapshot = new Map();
  for (const fixture of fixtures) {
    const target = join(workingDirectory, fixture.path);
    if (fixture.kind === "directory") {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    if (fixture.kind === "text") await writeFile(target, fixture.content);
    else await writeGeneratedFixture(target, fixture, options);
    if (fixture.modifiedAt) {
      const time = new Date(fixture.modifiedAt);
      await utimes(target, time, time);
    }
    snapshot.set(fixture.path, await hashFile(target));
  }
  return snapshot;
}

export async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function writeGeneratedFixture(
  target: string,
  fixture: GeneratedFixture,
  options: MaterializeOptions,
): Promise<void> {
  switch (fixture.generator) {
    case "png-text":
      return writeFile(target, renderTextPng(pngTextOptions.parse(fixture.options)));
    case "png-shape":
      return writeFile(target, renderShapePng(pngShapeOptions.parse(fixture.options)));
    case "xlsx":
      return writeFile(target, renderXlsx(tableOptions.parse(fixture.options)));
    case "docx":
      return writeFile(target, renderDocx(docxOptions.parse(fixture.options)));
    case "pdf":
      return writeFile(target, renderPdf(pdfOptions.parse(fixture.options)));
    case "csv":
      return writeCsvFixture(target, tableOptions.parse(fixture.options), options);
  }
}

async function writeCsvFixture(
  target: string,
  table: TableOptions,
  options: MaterializeOptions,
): Promise<void> {
  if ((table.rows ?? 0) < cachedCsvRowThreshold) return writeCsv(target, table);
  const cached = await ensureCachedCsv(
    table,
    options.cacheDirectory ?? defaultFixtureCacheDirectory,
  );
  // A copy-on-write clone on APFS: instant, and no task can change the cached file.
  await copyFile(cached, target, constants.COPYFILE_FICLONE);
}

/** Generates a large CSV once and reuses it across tasks and runs. */
export async function ensureCachedCsv(
  table: TableOptions,
  cacheDirectory: string,
): Promise<string> {
  const cached = join(cacheDirectory, `${table.dataset}-${table.rows}.csv`);
  if (await exists(cached)) return cached;
  await mkdir(cacheDirectory, { recursive: true });
  // Write under a temporary name so an interrupted run never leaves a partial file behind.
  const partial = `${cached}.${process.pid}.partial`;
  await writeCsv(partial, table);
  await rename(partial, cached);
  return cached;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
