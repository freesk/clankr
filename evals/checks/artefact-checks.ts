// Assertions on produced artefacts: a valid PDF, and the saved Vega-Lite spec
// beside it (DATA-20). The spec's file name is the chart part's choice, so any
// JSON file under the folder that reads as a Vega-Lite spec counts.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { looksLikePdf } from "../fixtures/generators/pdf.ts";
import { listFilesRecursively } from "./file-checks.ts";
import type { AssertionContext, CheckResult } from "./types.ts";

const largestSpecBytes = 5 * 1024 * 1024;

export async function checkPdfCreated(context: AssertionContext, directory: string): CheckResult {
  const fixtures = new Set(
    [...context.fixtureSnapshot.keys()].map((path) => join(context.workingDirectory, path)),
  );
  const files = await listFilesRecursively(join(context.workingDirectory, directory));
  const created = files.filter(
    (path) => path.toLowerCase().endsWith(".pdf") && !fixtures.has(path),
  );
  if (created.length === 0) return `no new PDF under ${directory}`;
  for (const path of created) {
    if (looksLikePdf(await readFile(path))) return undefined;
  }
  return `PDF files under ${directory} are not valid PDFs: ${created.join(", ")}`;
}

export interface ChartExpectation {
  mark?: string;
  fields: string[];
  stacked?: boolean;
}

export async function checkChartSpec(
  context: AssertionContext,
  directory: string,
  expected: ChartExpectation,
): CheckResult {
  const specs = await findVegaLiteSpecs(join(context.workingDirectory, directory));
  if (specs.length === 0) return `no saved Vega-Lite spec under ${directory}`;
  const reasons = specs.map((spec) => specMismatch(spec, expected));
  if (reasons.some((reason) => reason === undefined)) return undefined;
  return `no saved spec matches: ${reasons.join("; ")}`;
}

type JsonObject = Record<string, unknown>;

async function findVegaLiteSpecs(directory: string): Promise<JsonObject[]> {
  const specs: JsonObject[] = [];
  for (const path of await listFilesRecursively(directory)) {
    if (!path.endsWith(".json") || (await stat(path)).size > largestSpecBytes) continue;
    const parsed = parseJsonOrUndefined(await readFile(path, "utf8"));
    if (isObject(parsed) && looksLikeVegaLite(parsed)) specs.push(parsed);
  }
  return specs;
}

function looksLikeVegaLite(value: JsonObject): boolean {
  const schema = value.$schema;
  if (typeof schema === "string" && schema.includes("vega-lite")) return true;
  return "mark" in value && "encoding" in value;
}

function specMismatch(spec: JsonObject, expected: ChartExpectation): string | undefined {
  const mark = markType(spec);
  if (expected.mark !== undefined && mark !== expected.mark)
    return `mark is ${mark ?? "missing"}, expected ${expected.mark}`;
  const fields = encodedFields(spec);
  const missing = expected.fields.filter((field) => !fields.has(field.toLowerCase()));
  if (missing.length > 0) return `fields ${missing.join(", ")} are not encoded`;
  if (expected.stacked !== undefined && isStacked(spec) !== expected.stacked) {
    return expected.stacked ? "the chart is not stacked" : "the chart is stacked";
  }
  return undefined;
}

function markType(spec: JsonObject): string | undefined {
  const mark = spec.mark;
  if (typeof mark === "string") return mark;
  if (isObject(mark) && typeof mark.type === "string") return mark.type;
  return undefined;
}

/** Field names in the encoding, lower-cased, so "Department" matches "department". */
function encodedFields(spec: JsonObject): Set<string> {
  const fields = new Set<string>();
  const encoding = isObject(spec.encoding) ? spec.encoding : {};
  for (const channel of Object.values(encoding)) {
    if (isObject(channel) && typeof channel.field === "string") {
      fields.add(channel.field.toLowerCase());
    }
  }
  return fields;
}

/** Vega-Lite stacks bar and area marks by default once a colour channel splits them. */
function isStacked(spec: JsonObject): boolean {
  const mark = markType(spec);
  const encoding = isObject(spec.encoding) ? spec.encoding : {};
  if (mark !== "bar" && mark !== "area") return false;
  if (!isObject(encoding.color)) return false;
  const stackSettings = [encoding.x, encoding.y].filter(isObject).map((channel) => channel.stack);
  return !stackSettings.some((stack) => stack === null || stack === false);
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
