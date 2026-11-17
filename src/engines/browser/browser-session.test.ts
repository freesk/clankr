// D30 and "never outlive clankr": the browser starts late, is reused briefly, closes when idle,
// and is gone after every kind of exit.

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../../contracts/index.ts";
import { createChartRenderer, isBrowserVendored } from "./index.ts";
import { browserProcessTree } from "./test-support.ts";

const theme: Theme = {
  palette: ["#4e79a7"],
  fontFamily: "Helvetica Neue",
  page: { size: "A4", orientation: "landscape" },
};
const spec = {
  mark: "bar",
  encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
};
const rows = [{ a: "x", b: 1 }];

function newMarker(): string {
  return `clankr-test-marker=${randomUUID()}`;
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

const browserGone = (marker: string) => async () => (await browserProcessTree(marker)).length === 0;

describe.skipIf(!isBrowserVendored())("browser lifecycle (needs `npm run vendor`)", () => {
  let folder: string;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "clankr-lifecycle-"));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const output = (format = "svg") => join(folder, `${randomUUID()}.${format}`);

  it("starts no browser until the first render", async () => {
    const renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    expect(renderer.session.isRunning).toBe(false);
    expect(renderer.session.launchCount).toBe(0);
    await renderer.close();
  });

  it("reuses the browser within the idle period, with a fresh page each time", async () => {
    const renderer = createChartRenderer({ idleMilliseconds: 60_000 });
    try {
      await renderer.session.withRenderPage((page) =>
        page.evaluate(() => {
          (globalThis as { leftover?: string }).leftover = "chart data";
        }),
      );
      const leftover = await renderer.session.withRenderPage((page) =>
        page.evaluate(() => (globalThis as { leftover?: string }).leftover),
      );
      await renderer.renderChart({ spec, rows, theme, format: "svg", outputPath: output() });
      expect(leftover).toBeUndefined();
      expect(renderer.session.launchCount).toBe(1);
    } finally {
      await renderer.close();
    }
  });

  it("closes the browser once the idle period has passed, also after a failed render", async () => {
    const marker = newMarker();
    const renderer = createChartRenderer({
      idleMilliseconds: 300,
      extraLaunchArguments: [`--${marker}`],
    });
    await expect(
      renderer.renderChart({
        spec: { mark: "no-such-mark" },
        rows,
        theme,
        format: "svg",
        outputPath: output(),
      }),
    ).rejects.toThrow();
    expect((await browserProcessTree(marker)).length).toBeGreaterThan(0);
    expect(await waitUntil(browserGone(marker), 5_000)).toBe(true);
    expect(renderer.session.isRunning).toBe(false);
  });

  it("stops a render when its signal aborts and still closes when idle", async () => {
    const marker = newMarker();
    const renderer = createChartRenderer({
      idleMilliseconds: 300,
      extraLaunchArguments: [`--${marker}`],
    });
    const controller = new AbortController();
    const render = renderer.renderChart(
      { spec, rows, theme, format: "pdf", outputPath: output("pdf") },
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error("turn cancelled")), 50);
    await expect(render).rejects.toThrow(/turn cancelled/);
    expect(await waitUntil(browserGone(marker), 5_000)).toBe(true);
  });

  it("close() shuts the browser at once", async () => {
    const marker = newMarker();
    const renderer = createChartRenderer({
      idleMilliseconds: 60_000,
      extraLaunchArguments: [`--${marker}`],
    });
    await renderer.renderChart({ spec, rows, theme, format: "svg", outputPath: output() });
    await renderer.close();
    expect(await waitUntil(browserGone(marker), 3_000)).toBe(true);
  });

  for (const ending of ["exit", "SIGINT", "SIGTERM", "SIGKILL"] as const) {
    it(`leaves no browser behind when clankr ends by ${ending}`, async () => {
      const marker = newMarker();
      const child = await startRenderingChild(marker, ending === "exit");
      try {
        // After a plain exit the browser may already be gone; a kill needs it running first.
        if (ending !== "exit") {
          expect((await browserProcessTree(marker)).length).toBeGreaterThan(0);
          child.kill(ending);
        }
        expect(await waitUntil(browserGone(marker), 5_000)).toBe(true);
      } finally {
        child.kill("SIGKILL");
      }
    });
  }

  /** A separate Node process that renders once, then exits or waits to be killed. */
  async function startRenderingChild(
    marker: string,
    exitAfterRender: boolean,
  ): Promise<ChildProcess> {
    const script = join(folder, `child-${randomUUID()}.ts`);
    const rendererModule = join(import.meta.dirname, "index.ts");
    await writeFile(
      script,
      `import { createChartRenderer } from ${JSON.stringify(rendererModule)};
const renderer = createChartRenderer({ idleMilliseconds: 60_000, extraLaunchArguments: [${JSON.stringify(`--${marker}`)}] });
await renderer.renderChart({ spec: ${JSON.stringify(spec)}, rows: ${JSON.stringify(rows)}, theme: ${JSON.stringify(theme)}, format: "svg", outputPath: ${JSON.stringify(output())} });
console.log("rendered");
${exitAfterRender ? "process.exit(0);" : "setInterval(() => {}, 1000);"}
`,
    );
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("rendered")) resolve();
      });
      child.once("exit", (code) =>
        exitAfterRender ? resolve() : reject(new Error(`child exited ${code}`)),
      );
    });
    return child;
  }
});
