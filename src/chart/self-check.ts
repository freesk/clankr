// The vision self-check (DATA-18, D29): before the file is written, a small preview of the
// chart is shown to a vision-capable model in one separate request, with one question.
// Only the text verdict comes back; the image never enters the session's messages.

import type { ChatRequest, LoadedModel, ToolContext } from "../contracts/index.ts";

export interface SelfCheckVerdict {
  passed: boolean;
  /** One sentence from the model, shown to the main model and the user. */
  verdict: string;
}

/** Returns undefined when no check can run, for example on a model without vision. */
export type SelfCheck = (
  previewPng: Buffer,
  chartTitle: string,
  context: ToolContext,
) => Promise<SelfCheckVerdict | undefined>;

const instruction =
  "You check charts. Answer PASS or FAIL, then one short sentence. FAIL only if the chart is empty, " +
  "unreadable, has overlapping or cut-off labels, shows the words undefined or null, " +
  "or does not show what its title says.";

const maxVerdictCharacters = 300;

/** A self-check that asks the session's model, when that model reports vision. */
export function createVisionSelfCheck(currentModel: () => LoadedModel | undefined): SelfCheck {
  return async (previewPng, chartTitle, context) => {
    const model = currentModel();
    if (!model?.capabilities.vision) return undefined;
    const request: ChatRequest = {
      model: model.instanceId,
      reasoning: "off",
      maxTokens: 80,
      messages: [
        { role: "system", content: instruction },
        {
          role: "user",
          content: [
            { type: "text", text: `Is this chart readable? Title: ${chartTitle || "(none)"}` },
            { type: "image", mimeType: "image/png", dataBase64: previewPng.toString("base64") },
          ],
        },
      ],
    };
    let answer = "";
    for await (const event of context.lm.chat(request, context.signal)) {
      if (event.type === "text") answer += event.delta;
    }
    return parseVerdict(answer);
  };
}

/** Anything that does not start with PASS counts as a failure, so a confused answer is not a pass. */
export function parseVerdict(answer: string): SelfCheckVerdict {
  const trimmed = answer.trim();
  const passed = /^\W*pass\b/i.test(trimmed);
  const verdict = trimmed.replace(/^\W*(pass|fail)\b\W*/i, "").slice(0, maxVerdictCharacters);
  return { passed, verdict: verdict || (passed ? "Looks readable." : "No reason given.") };
}
