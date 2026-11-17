// The browser's lifecycle (D30): launched on the first render, reused for about a minute after
// the last one, then closed. Every render gets a fresh context and page, so nothing from one
// chart's data is visible to the next. Playwright is imported lazily to protect startup time.

import type { Browser, Page } from "playwright-core";
import {
  type BlockedRequestLogger,
  guardContextRequests,
  offlineLaunchArguments,
  renderOrigin,
} from "./offline.ts";
import { createRenderPageFiles, renderPagePath } from "./render-page.ts";
import { assertVendored, chromiumExecutablePath } from "./vendor-files.ts";

export interface BrowserSessionOptions {
  /** How long the browser stays open after the last render ends. */
  idleMilliseconds: number;
  logBlocked: BlockedRequestLogger;
  /** Extra Chromium flags, for tests only. */
  extraLaunchArguments?: string[];
}

export class BrowserSession {
  /** How many times a browser process was started. Tests use it to prove reuse. */
  launchCount = 0;
  private browserPromise: Promise<Browser> | undefined;
  private activeRenders = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly servedFiles = createRenderPageFiles();
  private readonly options: BrowserSessionOptions;

  constructor(options: BrowserSessionOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.browserPromise !== undefined;
  }

  /** Opens a fresh page on the render page, runs `work`, and always closes the page afterwards. */
  async withRenderPage<T>(work: (page: Page) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    this.cancelIdleTimer();
    this.activeRenders++;
    try {
      const browser = await this.browser();
      const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
      try {
        await guardContextRequests(context, this.servedFiles, this.options.logBlocked);
        const page = await context.newPage();
        await page.goto(`${renderOrigin}${renderPagePath}`);
        await page.waitForFunction(
          () => (globalThis as { clankrReady?: boolean }).clankrReady === true,
        );
        signal?.throwIfAborted();
        try {
          return await runUnlessAborted(work(page), signal);
        } finally {
          await flushBlockedReports(page);
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      this.activeRenders--;
      if (this.activeRenders === 0) this.startIdleTimer();
    }
  }

  /** Closes the browser now. Safe to call more than once, and on every exit path. */
  async close(): Promise<void> {
    this.cancelIdleTimer();
    const pending = this.browserPromise;
    this.browserPromise = undefined;
    if (!pending) return;
    const browser = await pending.catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  private browser(): Promise<Browser> {
    if (!this.browserPromise) {
      const launching = this.launch();
      this.browserPromise = launching;
      const forget = () => {
        if (this.browserPromise === launching) this.browserPromise = undefined;
      };
      // A failed launch or a crashed browser must not be reused by the next render.
      launching.then((browser) => browser.on("disconnected", forget), forget);
    }
    return this.browserPromise;
  }

  private async launch(): Promise<Browser> {
    assertVendored([chromiumExecutablePath]);
    const { chromium } = await import("playwright-core");
    this.launchCount++;
    return chromium.launch({
      executablePath: chromiumExecutablePath,
      headless: true,
      args: [...offlineLaunchArguments, ...(this.options.extraLaunchArguments ?? [])],
      // Ctrl-C belongs to the CLI, which cancels the turn and calls close() on exit. If clankr
      // dies without that, the browser loses its control pipe and exits on its own.
      handleSIGINT: false,
    });
  }

  private startIdleTimer(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => void this.close(), this.options.idleMilliseconds);
    // The idle timer alone must never keep clankr running.
    this.idleTimer.unref();
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}

/** Rejects as soon as the signal aborts; closing the page in `finally` then stops the work. */
function runUnlessAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    // Handlers go on first, so a page error after an abort is never an unhandled rejection.
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Content-security-policy violations are dispatched as queued page tasks and reported to
 * the host through a binding, so a blocked request can be reported after the work that
 * caused it has finished. Letting queued tasks run, then waiting for the round trip,
 * keeps those reports from being lost when the context closes (DATA-14).
 */
async function flushBlockedReports(page: Page): Promise<void> {
  await page
    .evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .catch(() => undefined);
}
