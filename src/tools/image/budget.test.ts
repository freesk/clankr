import { describe, expect, it } from "vitest";
import { ToolError } from "../../contracts/index.ts";
import { chooseMaxEdge, estimateImageTokens } from "./budget.ts";

describe("chooseMaxEdge", () => {
  const roomyBudget = { contextLength: 16_384, promptTokens: 100, answerTokens: 1024 };

  it("uses the configured edge when the context has room", () => {
    expect(chooseMaxEdge(1024, { width: 4000, height: 3000 }, roomyBudget)).toBe(1024);
  });

  it("shrinks the edge so the image fits a tight context", () => {
    const tightBudget = { contextLength: 3000, promptTokens: 100, answerTokens: 2048 };
    const size = { width: 4000, height: 3000 };
    const edge = chooseMaxEdge(1024, size, tightBudget);
    expect(edge).toBeLessThan(1024);

    const scaled = { width: edge, height: Math.round((edge * 3) / 4) };
    const room = tightBudget.contextLength - tightBudget.promptTokens - tightBudget.answerTokens;
    expect(estimateImageTokens(scaled)).toBeLessThanOrEqual(room);
  });

  it("refuses when the prompt leaves no room for the image", () => {
    const fullBudget = { contextLength: 2048, promptTokens: 1000, answerTokens: 1000 };
    expect(() => chooseMaxEdge(1024, { width: 800, height: 600 }, fullBudget)).toThrow(ToolError);
  });
});
