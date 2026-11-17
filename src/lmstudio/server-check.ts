// The startup probe: is LM Studio there, does it accept the token, and is it new enough (D23).

import { requestFailed } from "./errors.ts";
import type { LmStudioTransport } from "./transport.ts";

export const minimumLmStudioVersion = "0.4.0";

export const oldServerWarning =
  `This LM Studio does not offer the v1 API, so it is older than ${minimumLmStudioVersion}, ` +
  "the minimum clankr supports. Update LM Studio; clankr continues, but model features may fail.";

/**
 * Returns warnings to show. Throws the MOD-8 error for an unreachable server or a missing
 * or rejected token. LM Studio reports no version over HTTP, so a missing v1 API is how a
 * version below 0.4.0 shows itself: the v1 API arrived in 0.4.0.
 */
export async function checkServer(transport: LmStudioTransport): Promise<string[]> {
  const missingV1Api = requestFailed("checking the server", "the v1 API is missing");
  try {
    await transport.getJson("/api/v1/models", {
      what: "checking the server",
      onHttpError: (status, detail) =>
        status === 404
          ? missingV1Api
          : requestFailed("checking the server", `HTTP ${status}: ${detail}`),
    });
    return [];
  } catch (error) {
    if (error === missingV1Api) return [oldServerWarning];
    throw error;
  }
}
