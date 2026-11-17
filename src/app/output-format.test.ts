// What the harness tells a tool about the output format: the session's setting, the formats
// the user's latest message names (D86), and a question whose kept answer becomes the setting.

import { describe, expect, it } from "vitest";
import type { OutputFormatAnswer, OutputFormatPrompter } from "../contracts/index.ts";
import { outputFormatContextFor } from "./output-format.ts";
import { createSessionState } from "./session-state.ts";

function sessionWith(userMessages: string[]) {
  const state = createSessionState({ id: "s1", ephemeral: true, permissionMode: "ask" });
  for (const content of userMessages) {
    state.messages.push({ role: "user", content }, { role: "assistant", content: "ok" });
  }
  return state;
}

function prompterAnswering(answer: OutputFormatAnswer | undefined): OutputFormatPrompter {
  return { ask: async () => answer };
}

const signal = new AbortController().signal;
const question = { what: "chart", formats: ["pdf", "docx"] as const };

describe("outputFormatContextFor", () => {
  it("reads the formats named in the latest user message only", () => {
    const state = sessionWith(["Chart sales as a PDF", "Now the same by month"]);
    expect(outputFormatContextFor(state, undefined, signal).namedByUser).toEqual([]);

    state.messages.push({ role: "user", content: "and put it in Word" });
    expect(outputFormatContextFor(state, undefined, signal).namedByUser).toEqual(["docx"]);
  });

  it("carries the session format and offers no question without a prompter", () => {
    const state = sessionWith(["Chart sales"]);
    state.outputFormat = "xlsx";
    const context = outputFormatContextFor(state, undefined, signal);
    expect(context.sessionFormat).toBe("xlsx");
    expect(context.ask).toBeUndefined();
  });

  it("keeps a pick for the session only when the user asked for that", async () => {
    const state = sessionWith(["Chart sales"]);
    const once = outputFormatContextFor(
      state,
      prompterAnswering({ format: "docx", keepForSession: false }),
      signal,
    );
    expect(await once.ask?.(question)).toBe("docx");
    expect(state.outputFormat).toBeUndefined();

    const kept = outputFormatContextFor(
      state,
      prompterAnswering({ format: "pdf", keepForSession: true }),
      signal,
    );
    expect(await kept.ask?.(question)).toBe("pdf");
    expect(state.outputFormat).toBe("pdf");
  });

  it("passes a cancelled question on as no pick", async () => {
    const state = sessionWith(["Chart sales"]);
    const context = outputFormatContextFor(state, prompterAnswering(undefined), signal);
    expect(await context.ask?.(question)).toBeUndefined();
    expect(state.outputFormat).toBeUndefined();
  });
});
