// Runs model-written JavaScript in a fresh V8 isolate (decision D1). A new isolate per call means
// nothing one call leaves behind is visible to the next.

import type { Context, Isolate, Script } from "isolated-vm";
import type {
  IsolateHelper,
  IsolateResult,
  JsonValue,
  RunInIsolate,
} from "../../contracts/index.ts";
import {
  cancelledMessage,
  hostErrorMessage,
  type ModelCodeFailure,
  modelCodeFailureMessage,
} from "./error-messages.ts";
import { ExecutionStopper } from "./execution-stopper.ts";
import { assertValidHelperNames, createHelperDispatcher, LogCollector } from "./helper-bridge.ts";
import { bootstrapSource, modelCodeFilename, wrapModelCode } from "./isolate-source.ts";
import { type IsolatedVmModule, loadIsolatedVm } from "./load-addon.ts";

/** `isolated-vm` refuses smaller memory limits. */
const minimumMemoryLimitMb = 8;

type ModelCodeOutcome = { ok: true; value?: JsonValue } | ({ ok: false } & ModelCodeFailure);

export const runInIsolate: RunInIsolate = async (code, helpers, limits, signal) => {
  assertValidHelperNames(helpers);
  const logs = new LogCollector();
  if (signal?.aborted) return { ok: false, error: cancelledMessage, logs: [] };

  const ivm = await loadIsolatedVm();
  const isolate = new ivm.Isolate({
    memoryLimit: Math.max(limits.memoryLimitMb, minimumMemoryLimitMb),
  });
  const stopper = new ExecutionStopper(isolate, limits.timeoutMs, signal);
  const codeLineCount = code.split("\n").length;
  try {
    const context = await isolate.createContext();
    await installBootstrap(ivm, context, helpers, logs);
    const script = await compileModelCode(isolate, code);
    const outcomeJson: unknown = await script.run(context, {
      promise: true,
      timeout: limits.timeoutMs,
    });
    return toIsolateResult(parseOutcome(outcomeJson), logs, codeLineCount);
  } catch (error) {
    const message = hostErrorMessage(error, stopper.reason, limits, codeLineCount);
    return { ok: false, error: message, logs: logs.lines() };
  } finally {
    stopper.release();
    if (!isolate.isDisposed) isolate.dispose();
  }
};

async function installBootstrap(
  ivm: IsolatedVmModule,
  context: Context,
  helpers: Record<string, IsolateHelper>,
  logs: LogCollector,
): Promise<void> {
  const logReference = new ivm.Reference((line: string) => logs.add(String(line)));
  const helperReference = new ivm.Reference(createHelperDispatcher(helpers));
  await context.evalClosure(
    bootstrapSource,
    [logReference, helperReference, JSON.stringify(Object.keys(helpers))],
    { filename: "vix-bootstrap.js" },
  );
}

/**
 * Compiles the code as an expression first, so a bare `rows.map(...)` returns its value, and
 * falls back to statements, where the model uses `return`. A syntax error is reported for the
 * statements form, the one that matches what the model most likely meant when both fail.
 */
async function compileModelCode(isolate: Isolate, code: string): Promise<Script> {
  const origin = { filename: modelCodeFilename, lineOffset: -1 };
  try {
    return await isolate.compileScript(wrapModelCode(code, "expression"), origin);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return await isolate.compileScript(wrapModelCode(code, "statements"), origin);
  }
}

function parseOutcome(outcomeJson: unknown): ModelCodeOutcome {
  if (typeof outcomeJson !== "string") {
    return { ok: false, message: "The code did not finish normally." };
  }
  return JSON.parse(outcomeJson) as ModelCodeOutcome;
}

function toIsolateResult(
  outcome: ModelCodeOutcome,
  logs: LogCollector,
  codeLineCount: number,
): IsolateResult {
  if (outcome.ok) return { ok: true, value: outcome.value, logs: logs.lines() };
  return {
    ok: false,
    error: modelCodeFailureMessage(outcome, codeLineCount),
    logs: logs.lines(),
  };
}
