// Detects what a file is from its first bytes, never from its extension.

import { open } from "node:fs/promises";

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "tiff" | "bmp" | "heic" | "avif";

export type DetectedContent =
  | { kind: "image"; format: ImageFormat }
  /** A known file type that is not an image, with a pointer to the tool that reads it. */
  | { kind: "not-image"; description: string; pointer: string }
  | { kind: "unknown" };

/** Listed in errors so the model knows what it can send. */
export const supportedFormatNames = "JPEG, PNG, WebP, HEIC, GIF, TIFF, BMP, AVIF";

/** Formats the bundled libvips cannot decode, so they go straight to `sips` (IMG-4). */
const formatsSharpCannotDecode: ReadonlySet<ImageFormat> = new Set(["heic", "bmp"]);

export function sharpCanDecode(format: ImageFormat): boolean {
  return !formatsSharpCannotDecode.has(format);
}

const headerByteCount = 4096;

export async function readFileHeader(path: string): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = new Uint8Array(headerByteCount);
    const { bytesRead } = await handle.read(buffer, 0, headerByteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function detectContent(header: Uint8Array): DetectedContent {
  const image = detectImageFormat(header);
  if (image) return { kind: "image", format: image };
  return detectNonImage(header) ?? { kind: "unknown" };
}

function detectImageFormat(header: Uint8Array): ImageFormat | undefined {
  if (startsWith(header, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WEBP") return "webp";
  if (ascii(header, 0, 6) === "GIF87a" || ascii(header, 0, 6) === "GIF89a") return "gif";
  if (startsWith(header, [0x49, 0x49, 0x2a, 0x00]) || startsWith(header, [0x4d, 0x4d, 0x00, 0x2a]))
    return "tiff";
  if (ascii(header, 0, 2) === "BM" && header.length >= 26) return "bmp";
  return detectHeifFamily(header);
}

const avifBrands = new Set(["avif", "avis"]);
const heicBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** HEIC and AVIF share the ISO base media container; the `ftyp` brand tells them apart. */
function detectHeifFamily(header: Uint8Array): ImageFormat | undefined {
  if (ascii(header, 4, 4) !== "ftyp") return undefined;
  const majorBrand = ascii(header, 8, 4);
  if (avifBrands.has(majorBrand)) return "avif";
  if (heicBrands.has(majorBrand)) return "heic";
  return undefined;
}

function detectNonImage(header: Uint8Array): DetectedContent | undefined {
  if (header.length === 0) {
    return { kind: "not-image", description: "an empty file", pointer: "It has no content." };
  }
  if (ascii(header, 0, 5) === "%PDF-") {
    return {
      kind: "not-image",
      description: "a PDF document",
      pointer: "view_image cannot render PDF pages yet.",
    };
  }
  if (startsWith(header, [0x50, 0x4b, 0x03, 0x04])) {
    return {
      kind: "not-image",
      description: "a ZIP-based file, such as .xlsx or .docx",
      pointer: "Use inspect_data for spreadsheets and documents.",
    };
  }
  if (startsWith(header, [0xd0, 0xcf, 0x11, 0xe0])) {
    return {
      kind: "not-image",
      description: "a legacy Office file, such as .xls or .doc",
      pointer: "Use inspect_data for spreadsheets and documents.",
    };
  }
  if (looksLikeText(header)) {
    return { kind: "not-image", description: "a text file", pointer: "Use read_file to read it." };
  }
  return undefined;
}

/** Text has no NUL bytes and few control characters other than whitespace. */
function looksLikeText(header: Uint8Array): boolean {
  let controlCharacters = 0;
  for (const byte of header) {
    if (byte === 0) return false;
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
    if (byte < 0x20 && !isWhitespace) controlCharacters += 1;
  }
  return controlCharacters / header.length < 0.05;
}

function startsWith(header: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => header[index] === byte);
}

function ascii(header: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...header.subarray(start, start + length));
}
