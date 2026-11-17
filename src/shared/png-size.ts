// Just enough PNG reading to recognise a PNG and learn its pixel size from the header.

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The signature, then the IHDR chunk: length, type, width, height. */
const headerLength = 24;

export function isPng(bytes: Buffer): boolean {
  return bytes.length >= headerLength && bytes.subarray(0, 8).equals(pngSignature);
}

/** Width and height in pixels, from the PNG header. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (!isPng(png)) throw new Error("Not a PNG image.");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
