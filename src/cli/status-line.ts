// The status line (CLI-8): active model, context used versus available, permission mode.

import type { PermissionMode, UsageSnapshot } from "../contracts/index.ts";
import { formatTokenCount } from "./tool-lines.ts";

export interface StatusLineInput {
  /** The loaded model, or the configured default before one is loaded. */
  modelKey: string;
  usage: UsageSnapshot | undefined;
  permissionMode: PermissionMode;
  ephemeral: boolean;
}

export function formatContextUsage(usage: UsageSnapshot | undefined): string {
  if (!usage || usage.contextLength <= 0) return "context –";
  const percent = Math.round((usage.usedTokens / usage.contextLength) * 100);
  const used = formatTokenCount(usage.usedTokens);
  const available = formatTokenCount(usage.contextLength);
  return `${used} / ${available} tokens (${percent}%)`;
}

export function formatStatusLine(input: StatusLineInput): string {
  const parts = [input.modelKey, formatContextUsage(input.usage), input.permissionMode];
  if (input.ephemeral) parts.push("ephemeral");
  return parts.join(" · ");
}
