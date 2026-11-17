// capSummary: the hard cap on a sub-agent's summary.

import { describe, expect, it } from "vitest";
import { capSummary } from "./summary-cap.ts";

/** One token per four characters, like the scripted client. */
const countByCharacters = async (text: string) => Math.ceil(text.length / 4);

describe("capSummary", () => {
  it("leaves a summary within the cap alone", async () => {
    expect(await capSummary("short", 10, countByCharacters)).toEqual({
      text: "short",
      tokens: 2,
      truncated: false,
    });
  });

  it("cuts an over-cap summary at a word boundary and marks the cut", async () => {
    const text = "alpha beta gamma delta ".repeat(40);
    const capped = await capSummary(text, 30, countByCharacters);
    expect(capped.truncated).toBe(true);
    expect(capped.tokens).toBeLessThanOrEqual(30);
    expect(await countByCharacters(capped.text)).toBe(capped.tokens);
    expect(capped.text).toMatch(/(alpha|beta|gamma|delta) …\[summary cut to fit\]$/);
  });

  it("ends with an empty summary when not even the marker fits", async () => {
    const capped = await capSummary("x".repeat(100), 1, countByCharacters);
    expect(capped).toEqual({ text: "", tokens: 0, truncated: true });
  });
});
