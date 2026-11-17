// The one place that opens HTTP connections. It checks the host (SEC-1), adds the token
// header (MOD-2), and turns failures into typed errors whose text never contains the token.

import {
  type LmStudioError,
  requestFailed,
  scrubSecret,
  serverUnreachable,
  tokenMissing,
  tokenRejected,
} from "./errors.ts";
import { assertLoopbackHost, type HostResolver, systemResolver } from "./loopback.ts";

export interface TransportOptions {
  baseUrl: string;
  apiToken?: string | undefined;
  allowNonLoopbackHost: boolean;
  resolveHost?: HostResolver;
}

/** Builds the error for a non-2xx answer that is not an authentication failure. */
export type HttpErrorMapper = (status: number, detail: string) => LmStudioError;

interface SendOptions {
  /** Short description for error messages, for example "loading a model". */
  what: string;
  signal?: AbortSignal | undefined;
  onHttpError?: HttpErrorMapper;
}

export class LmStudioTransport {
  readonly baseUrl: string;
  private readonly apiToken: string | undefined;
  private readonly allowNonLoopbackHost: boolean;
  private readonly resolveHost: HostResolver;
  private hostCheck: Promise<void> | undefined;

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiToken = options.apiToken;
    this.allowNonLoopbackHost = options.allowNonLoopbackHost;
    this.resolveHost = options.resolveHost ?? systemResolver;
  }

  get hasToken(): boolean {
    return this.apiToken !== undefined;
  }

  /** The token, for the SDK connection only. Nothing else may read it. */
  tokenForSdk(): string | undefined {
    return this.apiToken;
  }

  /** Resolves the host once; every request and the SDK connection wait on it. */
  ensureHostAllowed(): Promise<void> {
    if (this.allowNonLoopbackHost) return Promise.resolve();
    if (!this.hostCheck) {
      this.hostCheck = assertLoopbackHost(this.baseUrl, this.resolveHost);
      // A failed check is retried on the next request instead of being cached forever.
      this.hostCheck.catch(() => {
        this.hostCheck = undefined;
      });
    }
    return this.hostCheck;
  }

  scrub(text: string): string {
    return scrubSecret(text, this.apiToken);
  }

  async getJson(path: string, options: SendOptions): Promise<unknown> {
    const response = await this.send(path, { method: "GET" }, options);
    return this.readJson(response, options.what);
  }

  async postJson(path: string, body: unknown, options: SendOptions): Promise<unknown> {
    const response = await this.send(path, jsonPost(body), options);
    return this.readJson(response, options.what);
  }

  /** Starts a streaming POST and returns the open body. Aborting the signal closes it. */
  async postStream(
    path: string,
    body: unknown,
    options: SendOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.send(path, jsonPost(body), options);
    if (!response.body) throw requestFailed(options.what, "the response had no body");
    return response.body;
  }

  private async send(path: string, init: RequestInit, options: SendOptions): Promise<Response> {
    await this.ensureHostAllowed();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.authorizationHeader(), ...init.headers },
        signal: options.signal ?? null,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw serverUnreachable(this.baseUrl);
    }
    if (response.ok) return response;
    throw await this.errorFor(response, options);
  }

  private authorizationHeader(): Record<string, string> {
    return this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {};
  }

  private async errorFor(response: Response, options: SendOptions): Promise<LmStudioError> {
    if (response.status === 401 || response.status === 403) {
      return this.apiToken ? tokenRejected() : tokenMissing();
    }
    const detail = this.scrub(await readErrorDetail(response));
    if (options.onHttpError) return options.onHttpError(response.status, detail);
    return requestFailed(options.what, `HTTP ${response.status}: ${detail}`);
  }

  private async readJson(response: Response, what: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw requestFailed(what, "the response was not valid JSON");
    }
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

const maxDetailLength = 300;

/** LM Studio answers errors as `{ error: { message } }` or `{ error: "..." }`. */
async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
      detail = parsed.error.message;
    }
  } catch {
    // Not JSON: keep the raw text.
  }
  detail = detail.trim() || response.statusText || "no detail given";
  return detail.length > maxDetailLength ? `${detail.slice(0, maxDetailLength)}...` : detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
