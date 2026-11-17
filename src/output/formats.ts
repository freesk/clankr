// What each output format can hold, and how a format is recognised in a file name or in the
// user's own words. The list of formats itself is in src/contracts/output.ts.

import { extname } from "node:path";
import { isOutputFormat, type OutputFormat, outputFormats } from "../contracts/index.ts";

/** Formats `make_chart` writes, in the order the format question offers them. */
export const chartOutputFormats: readonly OutputFormat[] = ["pdf", "docx", "xlsx", "png", "svg"];

/** Formats `export_table` writes, in the order the format question offers them. */
export const tableOutputFormats: readonly OutputFormat[] = ["xlsx", "docx", "pdf", "csv"];

/** A PNG or SVG file is one drawing; the other chart formats hold several charts. */
export function holdsSeveralCharts(format: OutputFormat): boolean {
  return format !== "png" && format !== "svg";
}

/** The format a path asks for by its extension, if it names one. */
export function formatFromPath(path: string): OutputFormat | undefined {
  const extension = extname(path).slice(1).toLowerCase();
  return isOutputFormat(extension) ? extension : undefined;
}

/** "pdf, docx, xlsx", for messages. */
export function formatList(formats: readonly OutputFormat[]): string {
  return formats.join(", ");
}

/**
 * Words that name a format when a person writes them. Matched as whole words, so "words" and
 * "pdfinfo" do not count. A file name such as "payroll.xlsx" matches too; see `formatsNamedIn`.
 */
const formatWords: Record<OutputFormat, RegExp> = {
  xlsx: /\b(?:xlsx|excel|spreadsheets?|workbooks?)\b/i,
  docx: /\b(?:docx?|word)\b/i,
  pdf: /\bpdfs?\b/i,
  png: /\b(?:png|images?|pictures?)\b/i,
  svg: /\bsvg\b/i,
  csv: /\bcsv\b/i,
};

/**
 * The formats a message names. Used only to tell a format the user asked for from one the
 * model guessed (D86), so it errs towards finding a format: a data file's own name counts
 * ("chart payroll.xlsx"), which at worst trusts the model's argument as before.
 */
export function formatsNamedIn(text: string): OutputFormat[] {
  return outputFormats.filter((format) => formatWords[format].test(text));
}
