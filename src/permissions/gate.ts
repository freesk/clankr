// The PermissionGate: classify every path a call touches, apply the decision table,
// and ask the user when the table says so. Grants come only from the user's answers,
// never from tool arguments or file content (SEC-7).

import type {
  ApprovalPrompter,
  ChangePreview,
  GateDecision,
  GatedTool,
  PathPolicy,
  PermissionGate,
  SessionState,
} from "../contracts/index.ts";
import {
  addGrants,
  type ClassifiedChange,
  decide,
  type RunGrants,
  type Verdict,
} from "./decision.ts";
import {
  cannotAskMessage,
  deniedPathMessage,
  readOnlyMessage,
  userDeniedMessage,
} from "./messages.ts";

export interface SessionPermissionGateOptions {
  /** Read live on every call, so `/permissions` changes take effect at once. */
  session: Pick<SessionState, "permissionMode" | "grants">;
  paths: PathPolicy;
  /** Absent in one-shot mode: anything that would ask is denied (D14). */
  prompter?: ApprovalPrompter;
  /** Grants from the command line, such as `--allow-data` (D74). */
  runGrants?: RunGrants;
}

export class SessionPermissionGate implements PermissionGate {
  private readonly options: SessionPermissionGateOptions;

  constructor(options: SessionPermissionGateOptions) {
    this.options = options;
  }

  // Arguments are deliberately unused: nothing the model writes can widen a grant.
  async check(
    tool: GatedTool,
    _args: Record<string, unknown>,
    preview?: ChangePreview,
  ): Promise<GateDecision> {
    const change = await this.classify(tool, preview);
    const { permissionMode, grants } = this.options.session;
    const verdict = decide(tool, permissionMode, grants, change, this.options.runGrants);
    if (verdict.kind === "ask") return this.ask(tool, preview, change, verdict);
    return decisionFor(tool, verdict);
  }

  private async classify(tool: GatedTool, preview?: ChangePreview): Promise<ClassifiedChange> {
    const classifyAll = (paths: string[] = []) =>
      Promise.all(paths.map((path) => this.options.paths.classify(path)));
    return {
      targets: await classifyAll(preview?.targetPaths),
      dataSources: await classifyAll(preview?.dataSourcePaths),
      previewMissing: tool.permission !== "read" && preview === undefined,
    };
  }

  /** Which run flag would have allowed this call, so a refusal can name it. */
  private wouldAllow(
    tool: GatedTool,
    change: ClassifiedChange,
  ): "auto-edit" | "allow-data" | undefined {
    const { grants } = this.options.session;
    if (decide(tool, "auto-edit", grants, change).kind === "allow") return "auto-edit";
    const withData = decide(tool, this.options.session.permissionMode, grants, change, {
      dataInAllowedFolders: true,
    });
    return withData.kind === "allow" ? "allow-data" : undefined;
  }

  private async ask(
    tool: GatedTool,
    preview: ChangePreview | undefined,
    change: ClassifiedChange,
    verdict: Extract<Verdict, { kind: "ask" }>,
  ): Promise<GateDecision> {
    const { prompter, session } = this.options;
    if (!prompter) {
      const feedback = cannotAskMessage(tool, verdict.reasons, this.wouldAllow(tool, change));
      return { allowed: false, feedback };
    }
    const answer = await prompter.ask({
      tool,
      preview: preview ?? { summary: `Run ${tool.name}`, targetPaths: [] },
      reason: verdict.reasons.join("; "),
      runFlag: this.wouldAllow(tool, change) ?? "none",
    });
    if (answer.kind === "deny") {
      return { allowed: false, feedback: userDeniedMessage(tool.name, answer.feedback) };
    }
    if (answer.kind === "once") return { allowed: true, basis: "approved-once" };
    addGrants(session.grants, verdict.grantable);
    return { allowed: true, basis: "approved-for-session" };
  }
}

function decisionFor(tool: GatedTool, verdict: Exclude<Verdict, { kind: "ask" }>): GateDecision {
  switch (verdict.kind) {
    case "allow":
      return { allowed: true, basis: verdict.basis };
    case "refuse-denied-path":
      return { allowed: false, feedback: deniedPathMessage(verdict.realPath) };
    case "refuse-read-only":
      return { allowed: false, feedback: readOnlyMessage(tool.name) };
  }
}
