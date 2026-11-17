// `clankr wipe` (CLI-6): confirm unless --yes (D32), then let storage delete everything.

import type { WipeReport } from "../contracts/index.ts";
import type { TextSink } from "./cli-environment.ts";
import { type ExitCode, exitCodes } from "./exit-codes.ts";
import { errorMessage } from "./secrets.ts";

export interface WipeRequest {
  assumeYes: boolean;
  /** False when stdin is piped, so there is nobody to ask. */
  canAsk: boolean;
  ask(question: string): Promise<string>;
  wipe(): Promise<WipeReport>;
  stdout: TextSink;
  stderr: TextSink;
}

const confirmation =
  "Delete all saved sessions, stored tool results, and logs under ~/.clankr? This cannot be undone. [y/N] ";

export async function runWipe(request: WipeRequest): Promise<ExitCode> {
  if (!request.assumeYes) {
    if (!request.canAsk) {
      request.stderr.write(
        "clankr: wipe needs confirmation; pass --yes when stdin is not a terminal.\n",
      );
      return exitCodes.usage;
    }
    const answer = await request.ask(confirmation);
    if (!/^y(es)?$/i.test(answer.trim())) {
      request.stdout.write("Nothing deleted.\n");
      return exitCodes.done;
    }
  }
  try {
    const report = await request.wipe();
    request.stdout.write(`${describeWipe(report)}\n`);
    return exitCodes.done;
  } catch (error) {
    request.stderr.write(`clankr: wipe failed: ${errorMessage(error)}\n`);
    return exitCodes.failed;
  }
}

function describeWipe(report: WipeReport): string {
  const megabytes = (report.bytesFreed / 1_000_000).toFixed(1);
  const sessions = report.sessionsRemoved === 1 ? "session" : "sessions";
  return `Deleted ${report.sessionsRemoved} ${sessions} and freed ${megabytes} MB.`;
}
