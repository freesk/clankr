// What a sub-agent may use (D18): read tools only, never `delegate`, and a gate that refuses
// anything else even if it slipped through. Because reads never prompt, no approval prompt
// can come from inside a sub-agent.

import type {
  ChangePreview,
  GateDecision,
  GatedTool,
  PermissionGate,
  ToolDefinition,
} from "../contracts/index.ts";

export const delegateToolName = "delegate";

/**
 * Chosen by permission class, not by a list of names, so a new write or execute tool can
 * never reach a sub-agent by accident. Excluding `delegate` is what forbids nesting.
 */
export function readOnlyTools(tools: readonly ToolDefinition[]): ToolDefinition[] {
  return tools.filter((tool) => tool.permission === "read" && tool.name !== delegateToolName);
}

/**
 * Wraps the session's gate. Reads still go through it, so the audit trail and path rules
 * are the same as in the main loop; anything else is refused before the gate could ask.
 */
export class ReadOnlyPermissionGate implements PermissionGate {
  private readonly inner: PermissionGate;

  constructor(inner: PermissionGate) {
    this.inner = inner;
  }

  async check(
    tool: GatedTool,
    args: Record<string, unknown>,
    preview?: ChangePreview,
  ): Promise<GateDecision> {
    if (tool.permission !== "read" || tool.name === delegateToolName) {
      return {
        allowed: false,
        feedback: `${tool.name} is not available to a sub-agent, which can only read.`,
      };
    }
    return this.inner.check(tool, args, preview);
  }
}
