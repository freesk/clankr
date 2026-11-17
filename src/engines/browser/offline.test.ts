// DATA-14 and SEC-4: the browser is offline. Blocked requests are logged, and a whole-process
// check watches the browser's real sockets while it renders, not only the intercepted requests.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../../contracts/index.ts";
import { type ChartRenderer, createChartRenderer, isBrowserVendored } from "./index.ts";
import { browserProcessTree, internetSockets } from "./test-support.ts";

// The browser's Image, used inside page.evaluate. The project compiles without DOM types.
declare const Image: new () => { src: string; onload: unknown; onerror: unknown };

const theme: Theme = {
  palette: ["#4e79a7"],
  fontFamily: "Helvetica Neue",
  page: { size: "A4", orientation: "portrait" },
};

const rows = [
  { month: "2026-01", total: 3 },
  { month: "2026-02", total: 5 },
];

const barSpec = {
  mark: "bar",
  encoding: {
    x: { field: "month", type: "nominal" },
    y: { field: "total", type: "quantitative" },
  },
};

/** A local server that counts connections: any connection at all means a leak. */
async function startCanary(): Promise<{ server: Server; port: number; connections: () => number }> {
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port, connections: () => connections };
}

describe.skipIf(!isBrowserVendored())("offline browser (needs `npm run vendor`)", () => {
  const marker = `clankr-test-marker=${randomUUID()}`;
  let renderer: ChartRenderer;
  let canary: Awaited<ReturnType<typeof startCanary>>;
  let folder: string;

  beforeAll(async () => {
    renderer = createChartRenderer({
      idleMilliseconds: 60_000,
      extraLaunchArguments: [`--${marker}`],
    });
    canary = await startCanary();
    folder = await mkdtemp(join(tmpdir(), "clankr-offline-"));
  });

  afterAll(async () => {
    await renderer.close();
    canary.server.close();
    await rm(folder, { recursive: true, force: true });
  });

  it("blocks and logs a request the page makes to its own origin for an unknown file", async () => {
    await renderer.session.withRenderPage((page) =>
      page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = image.onerror = () => resolve();
            image.src = "/not-served/secret.png";
          }),
      ),
    );
    expect(renderer.blockedRequests.map((request) => request.url)).toContainEqual(
      expect.stringContaining("/not-served/secret.png"),
    );
  });

  it("blocks and logs a fetch to another host", async () => {
    const url = `http://127.0.0.1:${canary.port}/leak-fetch`;
    const outcome = await renderer.session.withRenderPage((page) =>
      page.evaluate(
        (target) =>
          fetch(target).then(
            () => "reached",
            () => "blocked",
          ),
        url,
      ),
    );
    expect(outcome).toBe("blocked");
    expect(renderer.blockedRequests.map((request) => request.url)).toContain(url);
    expect(canary.connections()).toBe(0);
  });

  it("blocks and logs a navigation away from the render page", async () => {
    const url = `http://127.0.0.1:${canary.port}/leak-navigation`;
    await renderer.session.withRenderPage(async (page) => {
      await expect(page.goto(url)).rejects.toThrow();
    });
    expect(renderer.blockedRequests.map((request) => request.url)).toContain(url);
    expect(canary.connections()).toBe(0);
  });

  it("blocks a remote data URL in a nested view", async () => {
    const url = `http://127.0.0.1:${canary.port}/leak-data.csv`;
    const spec = { layer: [{ ...barSpec, data: { url } }] };
    await renderer
      .renderChart({ spec, rows, theme, format: "svg", outputPath: join(folder, "remote.svg") })
      .catch(() => undefined);
    expect(renderer.blockedRequests.map((request) => request.url)).toContain(url);
    expect(canary.connections()).toBe(0);
  });

  it("has a socket watcher that sees real sockets (positive control)", async () => {
    const control = await startCanary();
    const { connect } = await import("node:net");
    const socket = connect(control.port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    const sockets = await internetSockets([process.pid]);
    socket.destroy();
    control.server.close();
    expect(sockets.join("\n")).toContain(`:${control.port}`);
  });

  it("opens no internet socket from any browser process while rendering (SEC-4)", async () => {
    const observed: string[] = [];
    let processesSeen = 0;
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        const pids = await browserProcessTree(marker);
        processesSeen = Math.max(processesSeen, pids.length);
        observed.push(...(await internetSockets(pids)));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();

    for (const format of ["pdf", "png", "svg", "pdf"] as const) {
      const remote = { layer: [{ ...barSpec, data: { url: `http://example.com/${format}.csv` } }] };
      await renderer.renderChart({
        spec: barSpec,
        rows,
        theme,
        format,
        outputPath: join(folder, `watched-${randomUUID()}.${format}`),
      });
      await renderer
        .renderChart({
          spec: remote,
          rows,
          theme,
          format,
          outputPath: join(folder, `r-${randomUUID()}.${format}`),
        })
        .catch(() => undefined);
    }
    watching = false;
    await watcher;

    // The watcher really saw the browser: its main process and at least one helper.
    expect(processesSeen).toBeGreaterThanOrEqual(2);
    expect(observed).toEqual([]);
    expect(canary.connections()).toBe(0);
  });
});
