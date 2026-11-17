// Turns the AgentEvent stream of one run into the facts assertions and metrics
// use: the final answer, each tool call with its outcome, and how turns ended.

import type { AgentEvent, TurnEndReason } from "../../src/contracts/index.ts";

export interface ToolCallRecord {
  callId: string;
  tool: string;
  /** False until the call's tool-end arrives (a cancelled run can leave one open). */
  finished: boolean;
  error?: string;
  validity?: "valid" | "repaired" | "invalid";
}

export interface TurnEndRecord {
  reason: TurnEndReason;
  message?: string;
}

export class TranscriptRecorder {
  readonly toolCalls: ToolCallRecord[] = [];
  readonly turnEnds: TurnEndRecord[] = [];
  private currentTurnText = "";
  private lastTurnText = "";

  record(event: AgentEvent): void {
    switch (event.type) {
      case "text":
        this.currentTurnText += event.delta;
        return;
      case "reasoning":
        return;
      case "tool-start":
        this.toolCalls.push({ callId: event.callId, tool: event.tool, finished: false });
        return;
      case "tool-end":
        this.finishToolCall(event);
        return;
      case "turn-end":
        this.turnEnds.push({ reason: event.reason, message: event.message });
        this.lastTurnText = this.currentTurnText;
        this.currentTurnText = "";
        return;
    }
  }

  /** The text of the last completed turn: what the user would read as the answer. */
  get finalAnswer(): string {
    return this.lastTurnText;
  }

  private finishToolCall(event: Extract<AgentEvent, { type: "tool-end" }>): void {
    const call = this.toolCalls.findLast((candidate) => candidate.callId === event.callId);
    if (!call) return;
    call.finished = true;
    call.error = event.error;
    call.validity = event.validity;
  }
}
