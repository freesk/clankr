// The live activity line and the status line during a REPL turn, on fake timers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, UsageSnapshot } from "../../contracts/index.ts";
import { createFakeHarness, type FakeTurn } from "../testing/fake-harness.ts";
import { ReplController } from "./controller.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A turn whose events the test releases one step at a time. */
function steppedTurn() {
  const queue: (AgentEvent | undefined)[] = [];
  let wake: (() => void) | undefined;
  const send = (event?: AgentEvent) => {
    queue.push(event);
    wake?.();
  };
  const turn: FakeTurn = async function* () {
    for (;;) {
      while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const event = queue.shift();
      if (!event) return;
      yield event;
    }
  };
  return { turn, send };
}

function usageOf(usedTokens: number): UsageSnapshot {
  const byCategory = { system: 0, toolDefinitions: 0, history: 0, toolResults: 0 };
  return { contextLength: 16_384, usedTokens, byCategory };
}

describe("REPL turn activity", () => {
  it("redraws the activity line at least every 250 ms and clears it when the turn ends", async () => {
    const { turn, send } = steppedTurn();
    const harness = createFakeHarness({ turn });
    const controller = new ReplController({ harness, workingDirectory: "/work" });
    const finished = controller.submit("count the rows");

    send({ type: "model-call-start" });
    await vi.advanceTimersByTimeAsync(0);
    const frames: string[] = [];
    for (let tick = 0; tick < 8; tick++) {
      await vi.advanceTimersByTimeAsync(250);
      frames.push(controller.getState().activity ?? "");
    }
    // Every 250 ms step shows a different frame: the spinner moves even with no events.
    expect(new Set(frames).size).toBe(frames.length);
    expect(frames.at(-1)).toMatch(/^. waiting for the model · 2s$/);

    send({ type: "reasoning", delta: "Sum the column, then answer." });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getState().activity).toMatch(/^. thinking · 5 words · 3s$/);

    send({ type: "tool-start", callId: "c1", tool: "query_sql", keyArgument: "SELECT 1" });
    await vi.advanceTimersByTimeAsync(3_125);
    expect(controller.getState().activity).toMatch(/^. query_sql running · 3\.1s \(turn 6s\)$/);

    send({ type: "tool-end", callId: "c1", resultTokens: 40, durationMs: 3_100 });
    send({ type: "model-call-start" });
    send({ type: "text", delta: "There are 12 rows." });
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.getState().activity).toMatch(/^. writing answer · 4 words · 6s$/);
    // The transcript gets the tool line and, at the end, the answer: never a line per token.
    expect(controller.getState().entries.map((entry) => entry.kind)).toEqual([
      "info",
      "user",
      "reasoning",
      "tool",
    ]);

    send({ type: "turn-end", reason: "done" });
    send(undefined);
    await vi.advanceTimersByTimeAsync(0);
    await finished;
    expect(controller.getState().activity).toBeUndefined();
    expect(controller.getState().busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes the status line's token count after each model call, not only at the end", async () => {
    const { turn, send } = steppedTurn();
    let usage = usageOf(2_000);
    const harness = createFakeHarness({ turn });
    harness.usage = () => usage;
    const controller = new ReplController({ harness, workingDirectory: "/work" });
    const finished = controller.submit("go");

    usage = usageOf(3_100);
    send({ type: "tool-start", callId: "c1", tool: "read_file", keyArgument: "a.txt" });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().statusLine).toContain("3,100 / 16,384 tokens");

    usage = usageOf(3_900);
    send({ type: "tool-end", callId: "c1", resultTokens: 700, durationMs: 5 });
    send({ type: "model-call-start" });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().statusLine).toContain("3,900 / 16,384 tokens");

    usage = usageOf(4_200);
    send({ type: "turn-end", reason: "done" });
    send(undefined);
    await finished;
    expect(controller.getState().statusLine).toContain("4,200 / 16,384 tokens");
  });
});
