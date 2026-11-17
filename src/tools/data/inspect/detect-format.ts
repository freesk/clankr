// DATA-1: identify a file's real format from its content, not its name. Zip-based
// formats are told apart by what the archive contains; text files by their delimiter.

import { open } from "node:fs/promises";
import { extname } from "node:path";
import type { DataFormat } from "../../../contracts/index.ts";
import { ToolError } from "../../../contracts/index.ts";
import { ZipArchive } from "./zip-archive.ts";

export interface DetectedFormat {
  format: DataFormat;
  /** Field delimiter, for `.csv` and `.tsv`. */
  delimiter?: string;
  /** Set when the content disagrees with the file name. */
  mismatchNote?: string;
  /** For `.csv` and `.tsv`: the first physical lines, blank ones included, for header detection. */
  firstLines?: string[];
}

const sampleLineCount = 50;

const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const textSampleBytes = 64 * 1024;
const candidateDelimiters = ["\t", ",", ";", "|"];

export async function detectFormat(path: string): Promise<DetectedFormat> {
  const start = await readStart(path, textSampleBytes);
  const format = await formatFromContent(path, start);
  const detected = format === "csv" || format === "tsv" ? textFormat(start) : { format };
  return withMismatchNote(path, detected);
}

async function formatFromContent(path: string, start: Buffer): Promise<DataFormat> {
  if (start.subarray(0, 4).equals(zipSignature)) return zipFormat(path);
  if (start.subarray(0, 8).equals(oleSignature)) return "xls";
  if (start.includes(0)) {
    throw new ToolError(
      "This is a binary file that is not .xlsx, .xls, or .docx. inspect_data reads spreadsheets, CSV/TSV, and Word documents.",
    );
  }
  return "csv";
}

async function zipFormat(path: string): Promise<DataFormat> {
  const archive = await ZipArchive.open(path);
  try {
    if (archive.has("xl/workbook.xml")) return "xlsx";
    if (archive.has("word/document.xml")) return "docx";
  } finally {
    await archive.close();
  }
  throw new ToolError(
    "This is a zip archive but not an .xlsx workbook or a .docx document, so inspect_data cannot read it.",
  );
}

/** Picks the delimiter that splits the sample lines most consistently. */
function textFormat(start: Buffer): DetectedFormat {
  const firstLines = start
    .toString("utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .slice(0, sampleLineCount);
  // The last line of the sample may be cut off mid-way.
  if (firstLines.length > 1 && start.length === textSampleBytes) firstLines.pop();
  const lines = firstLines.filter((line) => line.trim() !== "");
  let best = { delimiter: ",", score: 0 };
  for (const delimiter of candidateDelimiters) {
    const score = delimiterScore(lines, delimiter);
    if (score > best.score) best = { delimiter, score };
  }
  const format = best.delimiter === "\t" ? "tsv" : "csv";
  return { format, delimiter: best.delimiter, firstLines };
}

/** How many lines share the most common field count, if that count is above one. */
function delimiterScore(lines: string[], delimiter: string): number {
  const linesByFieldCount = new Map<number, number>();
  for (const line of lines) {
    const fieldCount = line.split(delimiter).length;
    if (fieldCount > 1)
      linesByFieldCount.set(fieldCount, (linesByFieldCount.get(fieldCount) ?? 0) + 1);
  }
  return Math.max(0, ...linesByFieldCount.values());
}

const extensionsByFormat: Record<DataFormat, string[]> = {
  xlsx: [".xlsx", ".xlsm"],
  xls: [".xls"],
  csv: [".csv", ".txt"],
  tsv: [".tsv", ".tab", ".txt"],
  docx: [".docx"],
};

function withMismatchNote(path: string, detected: DetectedFormat): DetectedFormat {
  const extension = extname(path).toLowerCase();
  if (extensionsByFormat[detected.format].includes(extension)) return detected;
  const named = extension ? `named ${extension}` : "has no extension";
  return { ...detected, mismatchNote: `The file ${named} but its content is ${detected.format}.` };
}

async function readStart(path: string, byteCount: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
