import { describe, expect, it } from "vitest";
import { detectContent, sharpCanDecode } from "./format.ts";

function bytes(...parts: (string | number[])[]): Uint8Array {
  const values: number[] = [];
  for (const part of parts) {
    if (typeof part === "string")
      values.push(...[...part].map((character) => character.charCodeAt(0)));
    else values.push(...part);
  }
  // Pad so length-dependent checks (BMP) see a realistic header.
  while (values.length < 64) values.push(0);
  return Uint8Array.from(values);
}

describe("detectContent", () => {
  it.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["webp", bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")],
    ["gif", bytes("GIF89a")],
    ["tiff", bytes([0x49, 0x49, 0x2a, 0x00])],
    ["tiff", bytes([0x4d, 0x4d, 0x00, 0x2a])],
    ["bmp", bytes("BM")],
    ["heic", bytes([0, 0, 0, 0x24], "ftypheic")],
    ["heic", bytes([0, 0, 0, 0x18], "ftypmif1")],
    ["avif", bytes([0, 0, 0, 0x1c], "ftypavif")],
  ])("identifies %s from its signature", (format, header) => {
    expect(detectContent(header)).toEqual({ kind: "image", format });
  });

  it("points a PDF away from view_image", () => {
    expect(detectContent(bytes("%PDF-1.7\n"))).toMatchObject({
      kind: "not-image",
      description: "a PDF document",
    });
  });

  it("points spreadsheets and documents to inspect_data", () => {
    const zip = detectContent(bytes([0x50, 0x4b, 0x03, 0x04]));
    const legacy = detectContent(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    expect(zip).toMatchObject({
      kind: "not-image",
      pointer: expect.stringContaining("inspect_data"),
    });
    expect(legacy).toMatchObject({
      kind: "not-image",
      pointer: expect.stringContaining("inspect_data"),
    });
  });

  it("points text to read_file", () => {
    const text = new TextEncoder().encode("name,total\nCoffee,4.50\n");
    expect(detectContent(text)).toMatchObject({ kind: "not-image", description: "a text file" });
  });

  it("calls an empty file empty", () => {
    expect(detectContent(new Uint8Array())).toMatchObject({ description: "an empty file" });
  });

  it("reports unknown binary content as unknown", () => {
    expect(detectContent(Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0x00]))).toEqual({
      kind: "unknown",
    });
  });
});

describe("sharpCanDecode", () => {
  it("sends HEIC and BMP to sips and keeps the rest in sharp", () => {
    expect(sharpCanDecode("heic")).toBe(false);
    expect(sharpCanDecode("bmp")).toBe(false);
    expect(sharpCanDecode("jpeg")).toBe(true);
    expect(sharpCanDecode("gif")).toBe(true);
  });
});
