// Token budgets as fractions of the loaded context length (PRD section 7.1).
// No token count is fixed here: every number scales with the window.

import type { Config, ContextBudgets } from "../contracts/index.ts";

export type ContextSettings = Config["context"];

export function computeBudgets(contextLength: number, settings: ContextSettings): ContextBudgets {
  const shares = settings.budgetShares;
  return {
    contextLength,
    fixedOverhead: Math.floor(contextLength * shares.fixedOverhead),
    history: Math.floor(contextLength * shares.history),
    toolResults: Math.floor(contextLength * shares.toolResults),
    response: Math.floor(contextLength * shares.response),
  };
}

/** The limits the engine works to, derived from the budgets and the compaction settings. */
export interface WindowLimits {
  /** The prompt may never exceed this: the rest of the window is reserved for the reply. */
  hardLimit: number;
  /** Crossing this starts compaction (CTX-4). */
  compactAbove: number;
  /** Compaction tries to get back under this, so it does not run again on the next turn. */
  compactTarget: number;
  /** Most tokens a summary note may take. */
  summaryTokens: number;
}

export function computeWindowLimits(
  budgets: ContextBudgets,
  settings: ContextSettings,
): WindowLimits {
  const { contextLength } = budgets;
  const hardLimit = contextLength - budgets.response;
  const compactAbove = Math.min(
    Math.floor(contextLength * settings.compactionThreshold),
    hardLimit,
  );
  const compactTarget = Math.min(
    Math.floor(contextLength * settings.compactionTarget),
    compactAbove,
  );
  return {
    hardLimit,
    compactAbove,
    compactTarget,
    summaryTokens: Math.max(1, Math.floor(contextLength * settings.summaryShare)),
  };
}
