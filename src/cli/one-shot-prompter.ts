// One-shot mode never prompts (D14). Anything that would ask is denied, the model is told
// why and which run flag would have allowed it (D74), and the run remembers the denial so
// it can exit with status 1.

import type {
  ApprovalAnswer,
  ApprovalPrompter,
  ApprovalRequest,
  PermissionClass,
} from "../contracts/index.ts";

export interface Denial {
  tool: string;
  permission: PermissionClass;
  summary: string;
  reason: string;
}

/** The run flag that covers a kind of call: SQL, scripts, and charts need `--allow-data`. */
function flagHint(permission: PermissionClass): string {
  return permission === "execute"
    ? "--allow-data to allow SQL, scripts, and charts on data files inside the allowed folders"
    : "--permission-mode auto-edit to allow file changes inside the allowed folders";
}

export function oneShotDenialFeedback(permission: PermissionClass): string {
  return `Denied: one-shot mode cannot ask for approval. The user can rerun with ${flagHint(permission)}.`;
}

export class OneShotApprovalPrompter implements ApprovalPrompter {
  readonly denials: Denial[] = [];

  async ask(request: ApprovalRequest): Promise<ApprovalAnswer> {
    this.denials.push({
      tool: request.tool.name,
      permission: request.tool.permission,
      summary: request.preview.summary,
      reason: request.reason,
    });
    return { kind: "deny", feedback: oneShotDenialFeedback(request.tool.permission) };
  }
}

/** What the user sees on stderr for each denial. */
export function describeDenial(denial: Denial): string {
  return (
    `clankr: denied ${denial.tool} (${denial.summary}): ${denial.reason}. ` +
    `One-shot mode cannot ask; pass ${flagHint(denial.permission)}.`
  );
}
