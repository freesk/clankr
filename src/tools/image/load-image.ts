// Finds and opens the image a `view_image` call names: checks the path policy, identifies
// the format from content, and converts with `sips` what sharp cannot decode (IMG-4).

import { stat } from "node:fs/promises";
import { type ToolContext, ToolError } from "../../contracts/index.ts";
import { convertToPngWithSips } from "./convert-with-sips.ts";
import {
  detectContent,
  type ImageFormat,
  readFileHeader,
  sharpCanDecode,
  supportedFormatNames,
} from "./format.ts";
import { type DecodableImage, type ImageSize, readImageSize } from "./prepare-image.ts";

export interface OpenedImage {
  realPath: string;
  format: ImageFormat;
  /** The path itself when sharp reads the file, or PNG bytes after a conversion. */
  decodable: DecodableImage;
  size: ImageSize;
}

export async function openImage(path: string, context: ToolContext): Promise<OpenedImage> {
  const realPath = await checkReadable(path, context);
  const format = await identifyImageFormat(path, realPath);
  // The spec's order: sharp first, then sips for anything sharp cannot read.
  if (sharpCanDecode(format)) {
    const size = await readImageSize(realPath).catch((error: unknown) => {
      if (context.signal.aborted) throw error;
      return undefined;
    });
    if (size) return { realPath, format, decodable: realPath, size };
  }
  const converted = await convert(realPath, context);
  return { realPath, format, decodable: converted, size: await readImageSize(converted) };
}

async function checkReadable(path: string, context: ToolContext): Promise<string> {
  const { realPath, pathClass } = await context.paths.classify(path);
  if (pathClass === "denied") {
    throw new ToolError(`${path} is on the protected list and cannot be read.`);
  }
  const fileStat = await stat(realPath).catch(() => undefined);
  if (!fileStat) throw new ToolError(`${path} does not exist. Use find_files to locate it.`);
  if (fileStat.isDirectory()) {
    throw new ToolError(`${path} is a folder, not an image. Use list_dir to see its contents.`);
  }
  return realPath;
}

async function identifyImageFormat(path: string, realPath: string): Promise<ImageFormat> {
  const content = detectContent(await readFileHeader(realPath));
  if (content.kind === "image") return content.format;
  if (content.kind === "not-image") {
    throw new ToolError(`${path} is ${content.description}, not an image. ${content.pointer}`);
  }
  throw new ToolError(
    `${path} is not in a supported image format. Supported: ${supportedFormatNames}.`,
  );
}

function convert(realPath: string, context: ToolContext): Promise<Buffer> {
  return convertToPngWithSips(realPath, {
    scratchDirectory: context.vixPaths.session.scratch,
    timeoutMs: context.config.image.conversionTimeoutMs,
    signal: context.signal,
  });
}
