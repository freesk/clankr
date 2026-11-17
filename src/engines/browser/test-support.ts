// Helpers for this part's tests: just enough PDF and PNG reading to check output, and finding
// the browser's processes and sockets for the offline proof. Not used by the harness itself.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

const runCommand = promisify(execFile);

interface PdfObject {
  dictionary: string;
  stream?: string;
}

function pdfObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  for (const match of text.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) {
    const body = match[2] ?? "";
    const streamStart = body.search(/stream\r?\n/);
    if (streamStart < 0) {
      objects.set(Number(match[1]), { dictionary: body });
      continue;
    }
    const dictionary = body.slice(0, streamStart);
    const dataStart = streamStart + (body[streamStart + 6] === "\r" ? 8 : 7);
    const raw = Buffer.from(body.slice(dataStart, body.lastIndexOf("endstream")), "latin1");
    const stream = dictionary.includes("/FlateDecode") ? safeInflate(raw) : raw.toString("latin1");
    objects.set(Number(match[1]), { dictionary, stream });
  }
  return objects;
}

function safeInflate(raw: Buffer): string {
  try {
    return inflateSync(raw).toString("latin1");
  } catch {
    return "";
  }
}

export function pdfPageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

/** Width and height of the first page in points. */
export function pdfPageSize(pdf: Buffer): { width: number; height: number } {
  const match = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
  return { width: Number(match?.[1]), height: Number(match?.[2]) };
}

export function pdfImageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0;
}

/** All text drawn in the PDF, with whitespace removed, decoded through each font's ToUnicode map. */
export function pdfText(pdf: Buffer): string {
  const objects = pdfObjects(pdf);
  const fontMaps = fontUnicodeMaps(objects);
  let text = "";
  for (const object of objects.values()) {
    if (!object.stream || !/T[jJ]/.test(object.stream)) continue;
    let currentFont: Map<number, string> | undefined;
    for (const operation of object.stream.matchAll(
      /\/([\w.+-]+)\s+[\d.]+\s+Tf|(\[[^\]]*\]|<[0-9A-Fa-f\s]*>)\s*T[jJ]/g,
    )) {
      if (operation[1]) currentFont = fontMaps.get(operation[1]);
      else if (operation[2] && currentFont) text += decodeHexStrings(operation[2], currentFont);
    }
  }
  // NFKC turns ligature glyphs such as "ﬁ" back into their letters.
  return text.normalize("NFKC").replaceAll(/\s+/g, "");
}

function fontUnicodeMaps(objects: Map<number, PdfObject>): Map<string, Map<number, string>> {
  const maps = new Map<string, Map<number, string>>();
  for (const object of objects.values()) {
    const fontDictionary = object.dictionary.match(/\/Font\s*<<([^>]*)>>/)?.[1];
    if (!fontDictionary) continue;
    for (const entry of fontDictionary.matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)) {
      const font = objects.get(Number(entry[2]));
      const toUnicode = font?.dictionary.match(/\/ToUnicode\s+(\d+) 0 R/)?.[1];
      const cmap = toUnicode ? objects.get(Number(toUnicode))?.stream : undefined;
      if (entry[1] && cmap) maps.set(entry[1], parseCmap(cmap));
    }
  }
  return maps;
}

function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(Number.parseInt(pair[1] ?? "", 16), hexToUnicode(pair[2] ?? ""));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of (block[1] ?? "").matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const start = Number.parseInt(range[1] ?? "", 16);
      const end = Number.parseInt(range[2] ?? "", 16);
      const first = Number.parseInt(range[3] ?? "", 16);
      for (let code = start; code <= end; code++)
        map.set(code, String.fromCodePoint(first + code - start));
    }
  }
  return map;
}

function hexToUnicode(hex: string): string {
  let text = "";
  for (let index = 0; index < hex.length; index += 4) {
    text += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4), 16));
  }
  return text;
}

function decodeHexStrings(operand: string, font: Map<number, string>): string {
  let text = "";
  for (const hexString of operand.matchAll(/<([0-9A-Fa-f\s]*)>/g)) {
    const hex = (hexString[1] ?? "").replaceAll(/\s/g, "");
    for (let index = 0; index < hex.length; index += 4) {
      text += font.get(Number.parseInt(hex.slice(index, index + 4), 16)) ?? "";
    }
  }
  return text;
}

/** Width and height from a PNG header. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function listPids(arguments_: string[]): Promise<number[]> {
  try {
    const { stdout } = await runCommand("pgrep", arguments_);
    return stdout.split("\n").filter(Boolean).map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches.
  }
}

/** The browser's main process (found by a marker flag on its command line) and every descendant. */
export async function browserProcessTree(marker: string): Promise<number[]> {
  const found = await listPids(["-f", marker]);
  const all = [...found];
  for (let index = 0; index < all.length; index++) {
    for (const child of await listPids(["-P", String(all[index])])) {
      if (!all.includes(child)) all.push(child);
    }
  }
  return all;
}

/** Internet sockets (TCP or UDP, any state) held by the given processes, as lsof lines. */
export async function internetSockets(pids: number[]): Promise<string[]> {
  if (pids.length === 0) return [];
  try {
    const { stdout } = await runCommand("lsof", ["-a", "-n", "-P", "-i", "-p", pids.join(",")]);
    return stdout.split("\n").slice(1).filter(Boolean);
  } catch {
    return []; // lsof exits 1 when it finds nothing.
  }
}
