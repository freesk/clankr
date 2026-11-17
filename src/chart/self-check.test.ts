import { describe, expect, it } from "vitest";
import type { LoadedModel } from "../contracts/index.ts";
import { createTestToolContext, respond, ScriptedLmClient, testModel } from "../testing/index.ts";
import { chartReferenceText, chartToolReference } from "./reference-text.ts";
import { createVisionSelfCheck, parseVerdict } from "./self-check.ts";

const visionModel: LoadedModel = {
  key: testModel.key,
  instanceId: "i1",
  contextLength: 16_384,
  capabilities: { vision: true, trainedForToolUse: true, reasoning: false },
};

describe("createVisionSelfCheck", () => {
  it("asks one separate question with the preview image and parses the verdict", async () => {
    const lm = new ScriptedLmClient([respond.text("FAIL: the x labels overlap.")]);
    const { context, cleanup } = await createTestToolContext({ lm });
    try {
      const check = createVisionSelfCheck(() => visionModel);
      const verdict = await check(Buffer.from("png-bytes"), "Pay by department", context);
      expect(verdict).toEqual({ passed: false, verdict: "the x labels overlap." });

      const request = lm.requests[0];
      expect(request?.tools).toBeUndefined();
      const user = request?.messages.find((message) => message.role === "user");
      expect(JSON.stringify(user)).toContain(Buffer.from("png-bytes").toString("base64"));
    } finally {
      await cleanup();
    }
  });

  it("does not run on a model without vision", async () => {
    const lm = new ScriptedLmClient();
    const { context, cleanup } = await createTestToolContext({ lm });
    try {
      const blind = {
        ...visionModel,
        capabilities: { ...visionModel.capabilities, vision: false },
      };
      expect(
        await createVisionSelfCheck(() => blind)(Buffer.from(""), "", context),
      ).toBeUndefined();
      expect(lm.requests).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it.each([
    ["PASS. Readable.", true, "Readable."],
    ["**pass** - fine", true, "fine"],
    ["The chart is fine", false, "The chart is fine"],
    ["", false, "No reason given."],
  ])("parses %j", (answer, passed, verdict) => {
    expect(parseVerdict(answer)).toEqual({ passed, verdict });
  });
});

describe("chart reference text (DATA-16)", () => {
  it("fits the budget of about 1,000 tokens", async () => {
    // A character-based estimate (4 characters per token); the real tokenizer needs LM Studio.
    const tokens = await new ScriptedLmClient().countTokens([
      { role: "system", content: chartReferenceText },
    ]);
    expect(tokens).toBeLessThanOrEqual(1_000);
  });

  it("is exported in the shape agent-loop expects", () => {
    expect(chartToolReference.toolName).toBe("make_chart");
    expect(chartToolReference.text).toBe(chartReferenceText);
    expect(chartToolReference.triggerWords).toContain("chart");
  });
});
