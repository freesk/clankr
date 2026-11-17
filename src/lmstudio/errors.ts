// Typed errors for everything that can go wrong talking to LM Studio.
// Each one carries the fix to show the user (MOD-8), and none may contain the API token.

/** The four MOD-8 startup cases, plus the two that can happen at any time. */
export type LmStudioErrorKind =
  | "server-unreachable"
  | "token-missing"
  | "token-rejected"
  | "model-not-downloaded"
  | "model-load-failed"
  | "host-not-allowed"
  | "request-failed";

export class LmStudioError extends Error {
  override readonly name = "LmStudioError";
  readonly kind: LmStudioErrorKind;
  /** What the user should do about it, in one or two sentences. */
  readonly fix: string;

  constructor(kind: LmStudioErrorKind, message: string, fix: string) {
    super(message);
    this.kind = kind;
    this.fix = fix;
  }

  /** The problem and the fix, ready to print. */
  describe(): string {
    return `${this.message}\nFix: ${this.fix}`;
  }
}

export function serverUnreachable(baseUrl: string): LmStudioError {
  return new LmStudioError(
    "server-unreachable",
    `LM Studio is not reachable at ${baseUrl}.`,
    "Open LM Studio and start the local server (Developer tab, or `lms server start`), " +
      "or set lmStudio.baseUrl in ~/.vix/config.json to where it runs.",
  );
}

export function tokenMissing(): LmStudioError {
  return new LmStudioError(
    "token-missing",
    "LM Studio requires an API token and none is configured.",
    "Create a token in LM Studio (Developer > Server Settings) and set the LM_API_TOKEN " +
      "environment variable, or lmStudio.apiToken in ~/.vix/config.json.",
  );
}

export function tokenRejected(): LmStudioError {
  return new LmStudioError(
    "token-rejected",
    "LM Studio rejected the configured API token.",
    "Check that LM_API_TOKEN (or lmStudio.apiToken in ~/.vix/config.json) holds a current " +
      "token from LM Studio's Developer > Server Settings.",
  );
}

export function modelNotDownloaded(key: string, available: string[]): LmStudioError {
  const choices = available.length > 0 ? ` Downloaded models: ${available.join(", ")}.` : "";
  return new LmStudioError(
    "model-not-downloaded",
    `The model "${key}" is not downloaded in LM Studio.${choices}`,
    `Download it with \`lms get ${key}\` or in LM Studio's Discover tab, ` +
      "or pick another model with /model or --model.",
  );
}

export function modelLoadFailed(key: string, detail: string): LmStudioError {
  return new LmStudioError(
    "model-load-failed",
    `LM Studio could not load "${key}": ${detail}`,
    "Free memory by unloading other models, or lower model.contextLength " +
      "(or the model's profile contextLength) in ~/.vix/config.json.",
  );
}

export function hostNotAllowed(host: string): LmStudioError {
  return new LmStudioError(
    "host-not-allowed",
    `Refusing to connect to ${host}: it is not a loopback address.`,
    "Point lmStudio.baseUrl at localhost, or set lmStudio.allowNonLoopbackHost to true " +
      "in ~/.vix/config.json if you really mean to use a remote server.",
  );
}

export function requestFailed(what: string, detail: string): LmStudioError {
  return new LmStudioError(
    "request-failed",
    `LM Studio request failed (${what}): ${detail}`,
    "Check the LM Studio server log (Developer tab) for details.",
  );
}

const redacted = "[redacted]";

/**
 * Removes the token from text built out of a server response. LM Studio echoes a
 * malformed token back in its 401 message, so every error text passes through here.
 */
export function scrubSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join(redacted);
}
