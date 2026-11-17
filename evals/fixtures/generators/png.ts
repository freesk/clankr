// PNG fixtures for the image tasks (S6), drawn pixel by pixel and encoded with
// node:zlib, so no image library is needed to build the suite.

import { crc32, deflateSync } from "node:zlib";
import { z } from "zod";
import { glyphHeight, glyphWidth, isInk, isSupportedCharacter } from "./bitmap-font.ts";

type Rgb = readonly [number, number, number];

const white: Rgb = [255, 255, 255];
const black: Rgb = [0, 0, 0];
const namedColors = {
  red: [220, 30, 30],
  green: [30, 160, 60],
  blue: [30, 70, 210],
  yellow: [240, 200, 20],
} as const satisfies Record<string, Rgb>;

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  // Plain fields, not parameter properties: `npm run evals` runs this file with
  // Node's type stripping, which supports erasable syntax only.
  constructor(width: number, height: number, background: Rgb) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index++) this.pixels.set(background, index * 3);
  }

  fillRectangle(left: number, top: number, size: { width: number; height: number }, color: Rgb) {
    for (let y = top; y < top + size.height; y++) {
      for (let x = left; x < left + size.width; x++) this.setPixel(x, y, color);
    }
  }

  setPixel(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set(color, (y * this.width + x) * 3);
  }
}

export function encodePng(canvas: Canvas): Buffer {
  const rowLength = canvas.width * 3 + 1;
  const raw = Buffer.alloc(rowLength * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    // Each scanline starts with filter type 0 (none).
    raw.set(
      canvas.pixels.subarray(y * canvas.width * 3, (y + 1) * canvas.width * 3),
      y * rowLength + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit depth, truecolour, default compression, filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

const pixelScale = 4;
const margin = 16;
const characterAdvance = glyphWidth + 1;
const lineAdvance = glyphHeight + 3;

export const pngTextOptions = z.object({ lines: z.array(z.string()).min(1) });

/** Black text on white, for example a receipt. */
export function renderTextPng(options: z.infer<typeof pngTextOptions>): Buffer {
  const unsupported = options.lines
    .join("")
    .split("")
    .filter((character) => !isSupportedCharacter(character));
  if (unsupported.length > 0) {
    throw new Error(`png-text cannot draw: ${[...new Set(unsupported)].join("")}`);
  }
  const longestLine = Math.max(...options.lines.map((line) => line.length));
  const canvas = new Canvas(
    margin * 2 + longestLine * characterAdvance * pixelScale,
    margin * 2 + options.lines.length * lineAdvance * pixelScale,
    white,
  );
  for (const [lineIndex, line] of options.lines.entries()) {
    for (const [characterIndex, character] of [...line].entries()) {
      drawGlyph(canvas, character, {
        left: margin + characterIndex * characterAdvance * pixelScale,
        top: margin + lineIndex * lineAdvance * pixelScale,
      });
    }
  }
  return encodePng(canvas);
}

function drawGlyph(canvas: Canvas, character: string, origin: { left: number; top: number }) {
  const cell = { width: pixelScale, height: pixelScale };
  for (let row = 0; row < glyphHeight; row++) {
    for (let column = 0; column < glyphWidth; column++) {
      if (!isInk(character, column, row)) continue;
      canvas.fillRectangle(
        origin.left + column * pixelScale,
        origin.top + row * pixelScale,
        cell,
        black,
      );
    }
  }
}

export const pngShapeOptions = z.object({
  color: z.enum(Object.keys(namedColors) as [keyof typeof namedColors]),
  shape: z.enum(["square", "circle"]).default("square"),
});

/** One coloured shape on white, for simple visual questions. */
export function renderShapePng(options: z.infer<typeof pngShapeOptions>): Buffer {
  const size = 200;
  const canvas = new Canvas(size, size, white);
  const color = namedColors[options.color];
  const center = size / 2;
  const radius = 60;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const insideSquare = Math.abs(x - center) <= radius && Math.abs(y - center) <= radius;
      const insideCircle = (x - center) ** 2 + (y - center) ** 2 <= radius ** 2;
      if (options.shape === "square" ? insideSquare : insideCircle) canvas.setPixel(x, y, color);
    }
  }
  return encodePng(canvas);
}
