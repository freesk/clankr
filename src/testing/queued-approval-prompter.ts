// An ApprovalPrompter that answers from a queue, for testing permission decisions.

import type { ApprovalAnswer, ApprovalPrompter, ApprovalRequest } from "../contracts/index.ts";

export class QueuedApprovalPrompter implements ApprovalPrompter {
  readonly requests: ApprovalRequest[] = [];
  private readonly answers: ApprovalAnswer[];

  constructor(answers: ApprovalAnswer[] = []) {
    this.answers = [...answers];
  }

  async ask(request: ApprovalRequest): Promise<ApprovalAnswer> {
    this.requests.push(request);
    const answer = this.answers.shift();
    if (!answer)
      throw new Error(`QueuedApprovalPrompter: no answer queued for ${request.tool.name}`);
    return answer;
  }
}
