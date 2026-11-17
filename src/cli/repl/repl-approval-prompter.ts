// The REPL's ApprovalPrompter. Permissions receives it when the harness is built, before the
// controller exists, so it forwards to the controller once connected.

import type { ApprovalAnswer, ApprovalPrompter, ApprovalRequest } from "../../contracts/index.ts";
import type { ReplController } from "./controller.ts";

export class ReplApprovalPrompter implements ApprovalPrompter {
  private controller: Pick<ReplController, "requestApproval"> | undefined;

  connect(controller: Pick<ReplController, "requestApproval">): void {
    this.controller = controller;
  }

  async ask(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswer> {
    if (!this.controller) {
      return { kind: "deny", feedback: "The terminal is not ready to ask for approval yet." };
    }
    return this.controller.requestApproval(request, signal);
  }
}
