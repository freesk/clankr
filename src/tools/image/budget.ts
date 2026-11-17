// Picks the edge to downscale to so the image, the prompt, and room for the answer all
// fit in the loaded context length (specs/image.md, "Budget the sub-call").

import { ToolError } from "../../contracts/index.ts";
import type { ImageSize } from "./prepare-image.ts";

/**
 * Provisional estimate of what an image costs: one token per 28 x 28 pixel patch, the
 * densest common scheme among local vision models, so the estimate errs high. Replace it
 * with the target model's measured cost when the M3 measurement settles the default edge.
 */
const pixelsPerImageToken = 28 * 28;

/** Covers chat-template tokens around the messages that a text count does not see. */
const templateMarginTokens = 128;

/** Below this an image is too small to say anything useful about. */
const minimumImageTokens = 64;

export function estimateImageTokens(size: ImageSize): number {
  return Math.ceil((size.width * size.height) / pixelsPerImageToken);
}

export interface SubCallBudget {
  contextLength: number;
  /** The instruction and the question, counted without the image. */
  promptTokens: number;
  /** The answer allowance the request asks for. */
  answerTokens: number;
}

/** The longest edge to scale to: the configured maximum, or less when the context is tight. */
export function chooseMaxEdge(
  configuredMaxEdge: number,
  imageSize: ImageSize,
  budget: SubCallBudget,
): number {
  const tokensForImage =
    budget.contextLength - budget.promptTokens - budget.answerTokens - templateMarginTokens;
  if (tokensForImage < minimumImageTokens) {
    throw new ToolError(
      "The question leaves no room for the image in the loaded context. Ask a shorter question.",
    );
  }
  return Math.min(configuredMaxEdge, longestEdgeWithin(tokensForImage, imageSize));
}

/**
 * Scaling keeps the aspect ratio, so with ratio = short / long the cost of a long edge L
 * is L * L * ratio / pixelsPerImageToken. Solve for L.
 */
function longestEdgeWithin(tokens: number, imageSize: ImageSize): number {
  const longEdge = Math.max(imageSize.width, imageSize.height);
  const shortEdge = Math.min(imageSize.width, imageSize.height);
  const aspectRatio = shortEdge / longEdge;
  return Math.max(1, Math.floor(Math.sqrt((tokens * pixelsPerImageToken) / aspectRatio)));
}
