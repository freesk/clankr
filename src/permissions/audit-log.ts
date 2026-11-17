// The audit log (PERM-8): one JSON line per tool call under `logs/audit.jsonl`.
// Arguments can hold sensitive values, so the file follows the storage rules (SEC-5)
// and is not written at all in an ephemeral session.

import type { AuditEntry, AuditLog, VixPaths } from "../contracts/index.ts";
import { appendPrivateFile, ensurePrivateDirectory } from "../storage/index.ts";

/** Longer string arguments (a whole file passed to write_file) are cut to this many characters. */
export const maxLoggedStringLength = 2_000;

const redactedMarker = "[redacted]";

export interface AuditLogOptions {
  vixPaths: VixPaths;
  ephemeral: boolean;
  /** Values that must never reach the file: the LM Studio API token (MOD-2). */
  secrets: (string | undefined)[];
}

export function createAuditLog(options: AuditLogOptions): AuditLog {
  if (options.ephemeral) return new DiscardingAuditLog();
  const secrets = options.secrets.filter((secret): secret is string => Boolean(secret));
  return new FileAuditLog(options.vixPaths, secrets);
}

export class FileAuditLog implements AuditLog {
  private readonly vixPaths: VixPaths;
  private readonly secrets: string[];
  // Chained so lines land in call order even when callers do not await.
  private pending: Promise<void> = Promise.resolve();

  constructor(vixPaths: VixPaths, secrets: string[]) {
    this.vixPaths = vixPaths;
    this.secrets = secrets;
  }

  record(entry: AuditEntry): Promise<void> {
    const line = this.formatLine(entry);
    const next = this.pending.then(() => this.append(line));
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async append(line: string): Promise<void> {
    await ensurePrivateDirectory(this.vixPaths.logsDirectory);
    await appendPrivateFile(this.vixPaths.auditLog, line);
  }

  private formatLine(entry: AuditEntry): string {
    const record = {
      time: new Date().toISOString(),
      ...entry,
      arguments: shortenStrings(entry.arguments),
    };
    return `${redact(JSON.stringify(record), this.secrets)}\n`;
  }
}

export class DiscardingAuditLog implements AuditLog {
  async record(): Promise<void> {}
}

// Redacted after serializing, in both raw and JSON-escaped form, so the token is caught
// wherever it hides: an argument, an error message, a nested value.
function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    const escaped = JSON.stringify(secret).slice(1, -1);
    result = result.replaceAll(escaped, redactedMarker).replaceAll(secret, redactedMarker);
  }
  return result;
}

function shortenStrings(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]));
}

function shorten(value: unknown): unknown {
  if (typeof value === "string" && value.length > maxLoggedStringLength) {
    const omitted = value.length - maxLoggedStringLength;
    return `${value.slice(0, maxLoggedStringLength)}… [${omitted} more characters]`;
  }
  if (Array.isArray(value)) return value.map(shorten);
  if (typeof value === "object" && value !== null) {
    return shortenStrings(value as Record<string, unknown>);
  }
  return value;
}
