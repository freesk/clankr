// The API token is never printed (MOD-2), even when another part puts it in an error message.

import type { Config } from "../contracts/index.ts";

const redactedMarker = "[redacted]";

export function redactSecrets(text: string, config: Config | undefined): string {
  const token = config?.lmStudio.apiToken;
  if (!token) return text;
  return text.split(token).join(redactedMarker);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
