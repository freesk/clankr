// Keeping the browser offline (DATA-14, SEC-4), in two of the three layers from specs/pdf.md.
// Layer 1, the page: every request is intercepted; only the render page's own files are
// served from memory and disk, and everything else is aborted and logged. Requests the page's
// content security policy refuses never reach interception; the page reports those, and they
// are logged the same way.
// Layer 2, the browser: background traffic is switched off and name resolution goes nowhere,
// so even traffic that interception does not see cannot reach a host.
// Layer 3, the proof, is the whole-process test in offline.test.ts.

import type { BrowserContext, Route } from "playwright-core";

/** The made-up origin the render page is served from. It never resolves (see the launch flags). */
export const renderOrigin = "http://clankr-render.invalid";

export const offlineLaunchArguments = [
  // Every host name resolves to nothing, so no connection can even be attempted by name.
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-sync",
  "--disable-client-side-phishing-detection",
  "--disable-default-apps",
  "--disable-extensions",
  "--no-pings",
  "--no-first-run",
  "--metrics-recording-only",
  "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,CertificateTransparencyComponentUpdater",
];

export interface BlockedRequest {
  url: string;
  method: string;
  resourceType: string;
  blockedAt: string;
}

/** Receives every blocked request. The harness wires this to the audit log. */
export type BlockedRequestLogger = (request: BlockedRequest) => void;

export interface ServedFile {
  contentType: string;
  body: string | Buffer;
  /** Extra response headers, such as the render page's content security policy. */
  headers?: Record<string, string>;
}

/** Looks up a served file by URL path, for example "/render.html". */
export type ServedFileLookup = (path: string) => Promise<ServedFile | undefined>;

/** Installs layer 1 on a browser context. Call before any page is opened. */
export async function guardContextRequests(
  context: BrowserContext,
  lookup: ServedFileLookup,
  logBlocked: BlockedRequestLogger,
): Promise<void> {
  await context.exposeBinding(
    "clankrReportBlocked",
    (_source, url: unknown, directive: unknown) => {
      logBlocked({
        url: String(url),
        method: "GET",
        resourceType: `content security policy (${String(directive)})`,
        blockedAt: new Date().toISOString(),
      });
    },
  );
  await context.route("**/*", async (route) => {
    const served = await findServedFile(route, lookup);
    if (served) {
      await route.fulfill({
        status: 200,
        contentType: served.contentType,
        body: served.body,
        headers: served.headers,
      });
      return;
    }
    const request = route.request();
    logBlocked({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      blockedAt: new Date().toISOString(),
    });
    await route.abort("blockedbyclient");
  });
}

async function findServedFile(
  route: Route,
  lookup: ServedFileLookup,
): Promise<ServedFile | undefined> {
  const request = route.request();
  if (request.method() !== "GET") return undefined;
  const url = new URL(request.url());
  if (url.origin !== renderOrigin) return undefined;
  return lookup(url.pathname);
}
