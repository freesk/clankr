// One-shot mode never prompts (D14). Anything that would ask is denied, the model is told
// why and which run flag would have allowed it (D74), and the run remembers the denial so
// it can exit with status 1.

import type { ApprovalAnswer, ApprovalPrompter, ApprovalRequest } from "../contracts/index.ts";

type RunFlag = NonNullable<ApprovalRequest["runFlag"]>;

export interface Denial {
  tool: string;
  runFlag: RunFlag;
  summary: string;
  reason: string;
}

const allowDataHint =
  "--allow-data to allow SQL, scripts, and charts on data files inside the allowed folders";
const autoEditHint = "--permission-mode auto-edit to allow file changes inside the allowed folders";
const noFlagHint =
  "no run flag allows this. Only files inside the allowed folders can be covered: " +
  "run clankr from the folder that holds the file, or add it with `clankr config`";

/** The gate says which flag would help; without that, guess from the kind of call. */
function runFlagOf(request: ApprovalRequest): RunFlag {
  if (request.runFlag) return request.runFlag;
  return request.tool.permission === "execute" ? "allow-data" : "auto-edit";
}

function flagHint(runFlag: RunFlag): string {
  if (runFlag === "allow-data") return `pass ${allowDataHint}`;
  if (runFlag === "auto-edit") return `pass ${autoEditHint}`;
  return noFlagHint;
}

export function oneShotDenialFeedback(runFlag: RunFlag): string {
  const denied = "Denied: one-shot mode cannot ask for approval.";
  if (runFlag === "allow-data") return `${denied} The user can rerun with ${allowDataHint}.`;
  if (runFlag === "auto-edit") return `${denied} The user can rerun with ${autoEditHint}.`;
  return `${denied} Tell the user: ${noFlagHint}.`;
}

export class OneShotApprovalPrompter implements ApprovalPrompter {
  readonly denials: Denial[] = [];

  async ask(request: ApprovalRequest): Promise<ApprovalAnswer> {
    this.denials.push({
      tool: request.tool.name,
      runFlag: runFlagOf(request),
      summary: request.preview.summary,
      reason: request.reason,
    });
    return { kind: "deny", feedback: oneShotDenialFeedback(runFlagOf(request)) };
  }
}

/** What the user sees on stderr for each denial. */
export function describeDenial(denial: Denial): string {
  return (
    `clankr: denied ${denial.tool} (${denial.summary}): ${denial.reason}. ` +
    `One-shot mode cannot ask; ${flagHint(denial.runFlag)}.`
  );
}
