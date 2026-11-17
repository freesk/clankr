// One-off checks for the setup flow (`clankr config`): does LM Studio accept this token, which
// models does it offer, and is this base URL a loopback address (SEC-1). No session needed.

import type { ModelInfo } from "../contracts/index.ts";
import { assertLoopbackHost, type HostResolver } from "./loopback.ts";
import { fetchModels } from "./models-api.ts";
import { LmStudioTransport } from "./transport.ts";

export interface ProbeSettings {
  baseUrl: string;
  apiToken?: string | undefined;
  allowNonLoopbackHost: boolean;
  /** Replaces DNS resolution in tests. */
  resolveHost?: HostResolver;
}

/**
 * Lists the downloaded models with `GET /api/v1/models`, which is also the token test.
 * Throws LmStudioError: "server-unreachable", "token-missing", "token-rejected",
 * "host-not-allowed", or "request-failed". No message contains the token.
 */
export function probeModels(settings: ProbeSettings): Promise<ModelInfo[]> {
  return fetchModels(new LmStudioTransport(settings));
}

/** False for a host that is, or resolves to, anything but a loopback address. */
export async function isLoopbackBaseUrl(baseUrl: string, resolve?: HostResolver): Promise<boolean> {
  try {
    await assertLoopbackHost(baseUrl, resolve);
    return true;
  } catch {
    return false;
  }
}
