import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { redactSecrets } from "./secrets.ts";
import { formatContextUsage, formatStatusLine } from "./status-line.ts";
import { formatToolLine, ToolLineTracker } from "./tool-lines.ts";

describe("tool lines", () => {
  it("shows tool, key argument, result size, and duration on one line", () => {
    const line = formatToolLine(
      { type: "tool-start", callId: "1", tool: "find_files", keyArgument: "*.pdf" },
      { type: "tool-end", callId: "1", resultTokens: 1834, durationMs: 1240 },
    );
    expect(line).toMatchObject({ text: "● find_files *.pdf · 1.8k tokens · 1.2 s", failed: false });
  });

  it("marks a failed call and shows the error", () => {
    const tracker = new ToolLineTracker();
    tracker.start({ type: "tool-start", callId: "7", tool: "write_file", keyArgument: "a.txt" });
    expect(tracker.runningTool()).toBe("write_file a.txt");
    const line = tracker.end({
      type: "tool-end",
      callId: "7",
      resultTokens: 0,
      durationMs: 3,
      error: "Denied by the user",
    });
    expect(line).toMatchObject({
      text: "✗ write_file a.txt · Denied by the user · 3 ms",
      failed: true,
    });
    expect(tracker.runningTool()).toBeUndefined();
  });

  it("shortens a long key argument to keep one line", () => {
    const line = formatToolLine(
      { type: "tool-start", callId: "1", tool: "search_content", keyArgument: "x".repeat(200) },
      { type: "tool-end", callId: "1", resultTokens: 5, durationMs: 10 },
    );
    expect(line.text.length).toBeLessThan(100);
  });
});

describe("status line", () => {
  it("shows model, context used versus available, and permission mode", () => {
    const text = formatStatusLine({
      modelKey: "google/gemma-4-12b-qat",
      usage: {
        contextLength: 16_384,
        usedTokens: 4_096,
        byCategory: { system: 0, toolDefinitions: 0, history: 0, toolResults: 0 },
      },
      permissionMode: "ask",
      ephemeral: true,
    });
    expect(text).toBe("google/gemma-4-12b-qat · 4,096 / 16,384 tokens (25%) · ask · ephemeral");
  });

  it("shows a change of a few dozen tokens in a large window", () => {
    const usageOf = (usedTokens: number) => ({
      contextLength: 32_768,
      usedTokens,
      byCategory: { system: 0, toolDefinitions: 0, history: 0, toolResults: 0 },
    });
    const before = formatContextUsage(usageOf(12_340));
    const after = formatContextUsage(usageOf(12_390));
    expect(before).not.toBe(after);
    expect(after).toBe("12,390 / 32,768 tokens (38%)");
  });

  it("shows a placeholder before anything is measured", () => {
    const text = formatStatusLine({
      modelKey: "m",
      usage: undefined,
      permissionMode: "read-only",
      ephemeral: false,
    });
    expect(text).toBe("m · context – · read-only");
  });
});

describe("redactSecrets", () => {
  it("removes the API token from any text", () => {
    const config = defaultConfig();
    config.lmStudio.apiToken = "sk-secret-123";
    expect(redactSecrets("401 for token sk-secret-123", config)).toBe("401 for token [redacted]");
  });
});
