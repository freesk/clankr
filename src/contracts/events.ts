// Rendering a turn (seam: agent-loop → cli, evals).

export type TurnEndReason = "done" | "cancelled" | "error" | "limit";

export type AgentEvent =
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
