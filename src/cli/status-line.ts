// The status line (CLI-8): active model, context used versus available, permission mode.

import type { PermissionMode, UsageSnapshot } from "../contracts/index.ts";
import type { Harness } from "./harness.ts";

export interface StatusLineInput {
  /** The loaded model, or the configured default before one is loaded. */
  modelKey: string;
  usage: UsageSnapshot | undefined;
  permissionMode: PermissionMode;
  ephemeral: boolean;
}

/**
 * Exact counts, not "12k": a turn adds a few hundred tokens, and a rounded count hid that
 * change from the user, who then could not tell the line was live.
 */
export function formatContextUsage(usage: UsageSnapshot | undefined): string {
  if (!usage || usage.contextLength <= 0) return "context –";
  const percent = Math.round((usage.usedTokens / usage.contextLength) * 100);
  const used = usage.usedTokens.toLocaleString("en-US");
  const available = usage.contextLength.toLocaleString("en-US");
  return `${used} / ${available} tokens (${percent}%)`;
}

export function formatStatusLine(input: StatusLineInput): string {
  const parts = [input.modelKey, formatContextUsage(input.usage), input.permissionMode];
  if (input.ephemeral) parts.push("ephemeral");
  return parts.join(" · ");
}

/** The line as it reads now: the session's model and mode, and the engine's latest count. */
export function statusLineFor(harness: Harness): string {
  const session = harness.session();
  return formatStatusLine({
    modelKey: session.model?.key ?? harness.config.model.default,
    usage: harness.usage(),
    permissionMode: session.permissionMode,
    ephemeral: session.ephemeral,
  });
}
