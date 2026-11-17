// One-shot mode never prompts (D14). Anything that would ask is denied, the model is told
// why, and the run remembers the denial so it can exit with status 1.

import type { ApprovalAnswer, ApprovalPrompter, ApprovalRequest } from "../contracts/index.ts";

export interface Denial {
  tool: string;
  summary: string;
  reason: string;
}

export const oneShotDenialFeedback =
  "Denied: one-shot mode cannot ask for approval. The user can rerun with " +
  "--permission-mode auto-edit to allow file changes.";

export class OneShotApprovalPrompter implements ApprovalPrompter {
  readonly denials: Denial[] = [];

  async ask(request: ApprovalRequest): Promise<ApprovalAnswer> {
    this.denials.push({
      tool: request.tool.name,
      summary: request.preview.summary,
      reason: request.reason,
    });
    return { kind: "deny", feedback: oneShotDenialFeedback };
  }
}

/** What the user sees on stderr for each denial. */
export function describeDenial(denial: Denial): string {
  return (
    `vix: denied ${denial.tool} (${denial.summary}): ${denial.reason}. ` +
    "One-shot mode cannot ask; pass --permission-mode auto-edit to allow changes."
  );
}
