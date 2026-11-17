// Running model-written JavaScript (seam: sandbox → chart). Sandbox implements these;
// chart receives them by injection, so it never imports sandbox's code.

import type { JsonValue, ResultStore } from "./results.ts";

/**
 * A host function exposed inside the isolate. The isolate sees it as synchronous
 * (specs/sandbox.md, "Helper style"), even when the host side returns a promise.
 */
export type IsolateHelper = (
  ...args: JsonValue[]
) => JsonValue | undefined | Promise<JsonValue | undefined>;

export interface IsolateLimits {
  timeoutMs: number;
  memoryLimitMb: number;
  /** Most rows `data` returns and `save` accepts. */
  rowCap: number;
}

export type IsolateResult =
  | { ok: true; value: JsonValue | undefined; logs: string[] }
  | { ok: false; error: string; logs: string[] };

export type RunInIsolate = (
  code: string,
  helpers: Record<string, IsolateHelper>,
  limits: IsolateLimits,
  signal?: AbortSignal,
) => Promise<IsolateResult>;

/** Builds the standard `data(handle)` and `save(name, rows)` helpers over a result store. */
export type StandardHelpersFactory = (
  results: ResultStore,
  limits: IsolateLimits,
) => Record<string, IsolateHelper>;
