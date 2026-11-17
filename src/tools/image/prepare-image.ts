// Turns decodable image bytes into what the model receives: oriented, downscaled to a
// maximum edge (never upscaled), stripped of metadata such as location, and re-encoded
// in one of the formats the chat request accepts (IMG-2).

import type { Sharp, SharpConstructor } from "sharp";
import type { UserContentPart } from "../../contracts/index.ts";
import type { ImageFormat } from "./format.ts";

type ImageMimeType = Extract<UserContentPart, { type: "image" }>["mimeType"];

export interface ImageSize {
  width: number;
  height: number;
}

export interface PreparedImage extends ImageSize {
  mimeType: ImageMimeType;
  dataBase64: string;
  /** Size before downscaling, after applying the orientation tag. */
  original: ImageSize;
}

/** A file path or bytes that sharp can decode. */
export type DecodableImage = string | Buffer;

let sharpLoading: Promise<SharpConstructor> | undefined;

/** sharp is loaded on first use, not at startup, because it is a large native module. */
async function loadSharp(): Promise<SharpConstructor> {
  sharpLoading ??= import("sharp").then((module) => module.default);
  return sharpLoading;
}

async function openImage(input: DecodableImage): Promise<Sharp> {
  const sharp = await loadSharp();
  // Only the first frame of a GIF or the first page of a TIFF is sent.
  return sharp(input, { pages: 1 });
}

/** The displayed size: width and height swap when the orientation tag rotates by 90 degrees. */
export async function readImageSize(input: DecodableImage): Promise<ImageSize> {
  const metadata = await (await openImage(input)).metadata();
  const size = metadata.autoOrient;
  if (!size.width || !size.height) throw new Error("The image has no dimensions.");
  return { width: size.width, height: size.height };
}

/**
 * `sourceFormat` decides the output encoding: JPEG, PNG, and WebP keep their own,
 * everything else becomes PNG, which is lossless and keeps small text legible.
 */
export async function prepareImage(
  input: DecodableImage,
  sourceFormat: ImageFormat,
  maxEdgePixels: number,
): Promise<PreparedImage> {
  const original = await readImageSize(input);
  const pipeline = (await openImage(input)).autoOrient().resize({
    width: maxEdgePixels,
    height: maxEdgePixels,
    fit: "inside",
    withoutEnlargement: true,
  });
  const mimeType = outputMimeType(sourceFormat);
  const { data, info } = await encode(pipeline, mimeType).toBuffer({ resolveWithObject: true });
  return {
    mimeType,
    dataBase64: data.toString("base64"),
    width: info.width,
    height: info.height,
    original,
  };
}

function outputMimeType(sourceFormat: ImageFormat): ImageMimeType {
  if (sourceFormat === "jpeg") return "image/jpeg";
  if (sourceFormat === "webp") return "image/webp";
  return "image/png";
}

/** sharp drops metadata unless asked to keep it, so encoding is also where location data goes. */
function encode(pipeline: Sharp, mimeType: ImageMimeType): Sharp {
  if (mimeType === "image/jpeg") return pipeline.jpeg({ quality: 90 });
  if (mimeType === "image/webp") return pipeline.webp({ quality: 90 });
  return pipeline.png();
}
