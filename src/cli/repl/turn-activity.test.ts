import { describe, expect, it } from "vitest";
import { formatElapsed, TurnActivity } from "./turn-activity.ts";

/** The line without its spinner frame, which depends only on the time. */
function withoutSpinner(line: string): string {
  return line.slice(2);
}

describe("TurnActivity", () => {
  it("waits for the model until the first token arrives", () => {
    const activity = new TurnActivity(0);
    activity.apply({ type: "model-call-start" }, 200);
    expect(withoutSpinner(activity.describe(4_300))).toBe("waiting for the model · 4s");
  });

  it("counts reasoning words while thinking, across deltas split mid-word", () => {
    const activity = new TurnActivity(0);
    activity.apply({ type: "model-call-start" }, 0);
    activity.apply({ type: "reasoning", delta: "The user wa" }, 1_000);
    activity.apply({ type: "reasoning", delta: "nts the to" }, 1_100);
    activity.apply({ type: "reasoning", delta: "tals\n" }, 1_200);
    expect(withoutSpinner(activity.describe(18_400))).toBe("thinking · 5 words · 18s");
  });

  it("counts answer words while writing", () => {
    const activity = new TurnActivity(0);
    activity.apply({ type: "model-call-start" }, 0);
    activity.apply({ type: "reasoning", delta: "plan" }, 1_000);
    activity.apply({ type: "text", delta: "You have three " }, 2_000);
    activity.apply({ type: "text", delta: "PDFs." }, 2_100);
    expect(withoutSpinner(activity.describe(23_000))).toBe("writing answer · 4 words · 23s");
  });

  it("shows the running tool's own time and the turn's", () => {
    const activity = new TurnActivity(0);
    activity.apply({ type: "tool-start", callId: "a", tool: "query_sql", keyArgument: "" }, 38_000);
    expect(withoutSpinner(activity.describe(41_100))).toBe("query_sql running · 3.1s (turn 41s)");
  });

  it("shows a sub-agent's call over its delegate, then the delegate again", () => {
    const activity = new TurnActivity(0);
    activity.apply({ type: "tool-start", callId: "d", tool: "delegate", keyArgument: "" }, 0);
    activity.apply(
      { type: "tool-start", callId: "s", tool: "delegate › read_file", keyArgument: "" },
      5_000,
    );
    expect(withoutSpinner(activity.describe(5_500))).toBe(
      "delegate › read_file running · 0.5s (turn 5s)",
    );
    activity.apply({ type: "tool-end", callId: "s", resultTokens: 10, durationMs: 600 }, 5_600);
    expect(withoutSpinner(activity.describe(7_000))).toBe("delegate running · 7.0s");
  });

  it("waits again after the last tool ends, and a new request resets the counts", () => {
    const activity = new TurnActivity(0);
    activity.apply({ type: "text", delta: "one two" }, 1_000);
    activity.apply({ type: "tool-start", callId: "a", tool: "read_file", keyArgument: "" }, 2_000);
    activity.apply({ type: "tool-end", callId: "a", resultTokens: 5, durationMs: 100 }, 2_100);
    expect(withoutSpinner(activity.describe(4_200))).toBe("waiting for the model · 2s (turn 4s)");
    activity.apply({ type: "model-call-start" }, 4_300);
    activity.apply({ type: "text", delta: "three" }, 5_000);
    expect(withoutSpinner(activity.describe(5_000))).toBe("writing answer · 1 word · 5s");
  });

  it("advances the spinner with time", () => {
    const activity = new TurnActivity(0);
    const frames = [0, 125, 250, 375].map((now) => activity.describe(now).slice(0, 1));
    expect(new Set(frames).size).toBe(4);
  });
});

describe("formatElapsed", () => {
  it("uses whole seconds, tenths when precise, and minutes past a minute", () => {
    expect(formatElapsed(18_900)).toBe("18s");
    expect(formatElapsed(3_140, true)).toBe("3.1s");
    expect(formatElapsed(125_000)).toBe("2m 05s");
  });
});
