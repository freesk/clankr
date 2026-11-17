// `view_image` (IMG-1 to IMG-5): look at a local image and answer a question about it, or
// transcribe its text, through an isolated sub-call. Only the answer text is returned.

import { z } from "zod";
import {
  type LoadedModel,
  type ToolContext,
  type ToolDefinition,
  ToolError,
  type ToolOutput,
} from "../../contracts/index.ts";
import { chooseMaxEdge } from "./budget.ts";
import { type OpenedImage, openImage } from "./load-image.ts";
import { type PreparedImage, prepareImage } from "./prepare-image.ts";
import {
  askAboutImage,
  buildImageRequest,
  buildPromptMessages,
  type ImageQuestion,
} from "./sub-call.ts";

const viewImageParameters = z.object({
  path: z.string().describe("The image file, absolute or relative to the working folder."),
  question: z.string().optional().describe("What to find out. Optional in transcribe mode."),
  mode: z
    .enum(["answer", "transcribe"])
    .default("answer")
    .describe('"transcribe" returns all text in the image, for screenshots, receipts, and scans.'),
});

type ViewImageArguments = z.infer<typeof viewImageParameters>;

/** Transcriptions run long; the agent loop stores anything beyond this behind a handle. */
const viewImageResultTokenCap = 1500;

export const viewImageTool: ToolDefinition<typeof viewImageParameters> = {
  name: "view_image",
  description:
    "Look at a local image (JPEG, PNG, WebP, HEIC, GIF, TIFF, BMP) and answer a question about it. " +
    'Use mode "transcribe" to extract all text from a screenshot, receipt, or scan.',
  parameters: viewImageParameters,
  permission: "read",
  resultTokenCap: viewImageResultTokenCap,
  groups: ["vision"],
  keyArgument: "path",
  run: viewImage,
};

async function viewImage(args: ViewImageArguments, context: ToolContext): Promise<ToolOutput> {
  const model = requireVisionModel(context.model);
  const question: ImageQuestion = { mode: args.mode, question: args.question };
  const answerTokens = answerAllowance(args.mode, context);
  const opened = await openImage(args.path, context);
  const maxEdge = chooseMaxEdge(context.config.image.maxEdgePixels, opened.size, {
    contextLength: model.contextLength,
    promptTokens: await context.lm.countTokens(buildPromptMessages(question)),
    answerTokens,
  });
  const prepared = await prepareOrExplain(opened, maxEdge, args.path);
  const request = buildImageRequest(question, prepared, {
    model,
    answerTokens,
    sessionReasoning: context.reasoning,
  });
  const answer = await askAboutImage(context.lm, request, context.signal);
  return { text: formatResult(args.path, prepared, answer) };
}

function requireVisionModel(model: LoadedModel | undefined): LoadedModel {
  if (!model)
    throw new ToolError("No model is loaded, so the image cannot be sent. Load one first.");
  if (!model.capabilities.vision) {
    throw new ToolError(
      `The loaded model ${model.key} cannot see images. Switch to a vision model.`,
    );
  }
  return model;
}

function answerAllowance(mode: ViewImageArguments["mode"], context: ToolContext): number {
  const settings = context.config.image;
  return mode === "transcribe" ? settings.transcribeAnswerTokens : settings.answerTokens;
}

async function prepareOrExplain(
  opened: OpenedImage,
  maxEdge: number,
  path: string,
): Promise<PreparedImage> {
  try {
    return await prepareImage(opened.decodable, opened.format, maxEdge);
  } catch {
    throw new ToolError(`${path} could not be decoded. It may be damaged; try another file.`);
  }
}

function formatResult(
  path: string,
  prepared: PreparedImage,
  answer: { text: string; truncated: boolean },
): string {
  const sentSize = `${prepared.width}x${prepared.height}`;
  const originalSize = `${prepared.original.width}x${prepared.original.height}`;
  const sizeNote = sentSize === originalSize ? sentSize : `${originalSize}, sent at ${sentSize}`;
  const lines = [`${path} (${sizeNote}):`, answer.text || "(The model gave no answer.)"];
  if (answer.truncated) lines.push("[The answer was cut off at its token allowance.]");
  return lines.join("\n");
}
