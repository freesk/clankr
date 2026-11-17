// Sub-agent tool calls shown as nested tool lines (specs/subagents.md, "Visibility").
// `delegate` reports its sub-agent's events through a callback while the main turn is
// waiting on it, so they are queued here and merged into the main turn's event stream.

import type { AgentEvent } from "../contracts/index.ts";
import { delegateToolName } from "../subagent/index.ts";

/** Marks a sub-agent's tool lines; the cli prints the tool name as is. */
const nestedToolPrefix = "delegate › ";

export class NestedEventQueue {
  private readonly queued: AgentEvent[] = [];
  private wake: (() => void) | undefined;
  private delegationNumber = 0;

  /** Only tool lines are shown; the sub-agent's text is its summary, which the tool returns. */
  push(event: AgentEvent): void {
    const nested = this.nest(event);
    if (!nested) return;
    this.queued.push(nested);
    this.wake?.();
  }

  /** Yields the main turn's events, with queued sub-agent events slotted in as they arrive. */
  async *merge(events: AsyncIterable<AgentEvent>): AsyncGenerator<AgentEvent> {
    const iterator = events[Symbol.asyncIterator]();
    let next = iterator.next();
    try {
      for (;;) {
        yield* this.drain();
        const arrived = await Promise.race([next, this.whenQueued()]);
        if (arrived === "queued") continue;
        yield* this.drain();
        if (arrived.done) return;
        // Each delegation numbers its calls apart, so its ids never collide with an earlier one's.
        if (arrived.value.type === "tool-start" && arrived.value.tool === delegateToolName) {
          this.delegationNumber += 1;
        }
        yield arrived.value;
        next = iterator.next();
      }
    } finally {
      // A consumer that stops early (Ctrl+C) still ends the inner turn, without waiting on it.
      void iterator.return?.()?.catch(() => undefined);
    }
  }

  private *drain(): Generator<AgentEvent> {
    while (this.queued.length > 0) yield this.queued.shift() as AgentEvent;
  }

  private whenQueued(): Promise<"queued"> {
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = undefined;
        resolve("queued");
      };
    });
  }

  private nest(event: AgentEvent): AgentEvent | undefined {
    const callId = (id: string) => `sub${this.delegationNumber}-${id}`;
    if (event.type === "tool-start") {
      return { ...event, callId: callId(event.callId), tool: `${nestedToolPrefix}${event.tool}` };
    }
    if (event.type === "tool-end") return { ...event, callId: callId(event.callId) };
    return undefined;
  }
}
