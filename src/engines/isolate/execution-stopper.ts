// The wall-clock limit. `isolated-vm`'s own `timeout` option only covers synchronous execution,
// so a promise that never settles would otherwise wait forever. Disposing the isolate stops
// everything: a tight loop, pending promises, and a helper call the isolate is waiting on.

import type { Isolate } from "isolated-vm";
import type { StopReason } from "./error-messages.ts";

export class ExecutionStopper {
  private stopReason: StopReason | undefined;
  private readonly timer: NodeJS.Timeout;
  private readonly onAbort = () => this.stop("cancelled");

  constructor(
    private readonly isolate: Isolate,
    timeoutMs: number,
    private readonly signal?: AbortSignal,
  ) {
    this.timer = setTimeout(() => this.stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", this.onAbort, { once: true });
  }

  /** Set when the host stopped the isolate, which explains the error the run then throws. */
  get reason(): StopReason | undefined {
    return this.stopReason;
  }

  /** Clears the timer and the abort listener. Call once the run has settled. */
  release(): void {
    clearTimeout(this.timer);
    this.signal?.removeEventListener("abort", this.onAbort);
  }

  private stop(reason: StopReason): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    if (!this.isolate.isDisposed) this.isolate.dispose();
  }
}
