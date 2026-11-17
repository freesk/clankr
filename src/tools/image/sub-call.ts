// The isolated sub-call (IMG-3): one model request with a short instruction, the question,
// and the image. No tools, no conversation history. Only the text answer comes back, so
// the image never enters the session's messages.

import type {
  ChatMessage,
  ChatRequest,
  LmClient,
  LoadedModel,
  ReasoningSetting,
} from "../../contracts/index.ts";
import type { PreparedImage } from "./prepare-image.ts";

export type ImageMode = "answer" | "transcribe";

const answerInstruction =
  "You are looking at one image on behalf of another assistant. Answer the question about " +
  "the image directly and concisely. If the image does not show the answer, say so.";

const transcribeInstruction =
  "Transcribe all text visible in the image exactly as written, in reading order, keeping " +
  "line breaks. Write table rows on one line each with cells separated by ' | '. Do not " +
  "summarize or add commentary. If the image contains no text, reply: No text found.";

export const defaultQuestion = "Describe this image.";

export interface ImageQuestion {
  mode: ImageMode;
  /** Optional in transcribe mode, where it narrows what to transcribe. */
  question?: string;
}

/** The text part of the sub-call, without the image, so it can be counted for the budget. */
export function buildPromptMessages(request: ImageQuestion): ChatMessage[] {
  return [
    { role: "system", content: instructionFor(request.mode) },
    { role: "user", content: questionText(request) },
  ];
}

function instructionFor(mode: ImageMode): string {
  return mode === "transcribe" ? transcribeInstruction : answerInstruction;
}

function questionText(request: ImageQuestion): string {
  if (request.question?.trim()) return request.question.trim();
  return request.mode === "transcribe" ? "Transcribe the text in this image." : defaultQuestion;
}

export interface SubCallSettings {
  model: LoadedModel;
  answerTokens: number;
  /** The session's `/think` setting. Transcribe mode always turns reasoning off. */
  sessionReasoning?: ReasoningSetting;
}

export function buildImageRequest(
  request: ImageQuestion,
  image: PreparedImage,
  settings: SubCallSettings,
): ChatRequest {
  const chatRequest: ChatRequest = {
    // The instance, not the key: its context length is the one the budget was computed for.
    model: settings.model.instanceId,
    messages: [
      { role: "system", content: instructionFor(request.mode) },
      {
        role: "user",
        content: [
          { type: "text", text: questionText(request) },
          { type: "image", mimeType: image.mimeType, dataBase64: image.dataBase64 },
        ],
      },
    ],
    maxTokens: settings.answerTokens,
  };
  const reasoning = request.mode === "transcribe" ? "off" : settings.sessionReasoning;
  if (reasoning) chatRequest.reasoning = reasoning;
  return chatRequest;
}

export interface ImageAnswer {
  text: string;
  /** True when the answer hit the token allowance and was cut off. */
  truncated: boolean;
}

/** Sends the request and keeps only the answer text. Reasoning deltas are dropped. */
export async function askAboutImage(
  lm: LmClient,
  request: ChatRequest,
  signal: AbortSignal,
): Promise<ImageAnswer> {
  let text = "";
  let truncated = false;
  for await (const event of lm.chat(request, signal)) {
    if (event.type === "text") text += event.delta;
    if (event.type === "done") truncated = event.finishReason === "length";
  }
  return { text: text.trim(), truncated };
}
