// Rendering a turn (seam: agent-loop → cli, evals).

export type TurnEndReason = "done" | "cancelled" | "error" | "limit";

export type AgentEvent =
  /**
   * A request is about to go to the model; its first token can take many seconds. Lets the
   * cli show "waiting for the model" and refresh the context count, which now includes the
   * results of the round before.
   */
  | { type: "model-call-start" }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-start"; callId: string; tool: string; keyArgument: string }
  | {
      type: "tool-end";
      callId: string;
      resultTokens: number;
      durationMs: number;
      error?: string;
      /** For evals' first-attempt validity metric (PRD section 10). */
      validity?: "valid" | "repaired" | "invalid";
    }
  | { type: "turn-end"; reason: TurnEndReason; message?: string };
