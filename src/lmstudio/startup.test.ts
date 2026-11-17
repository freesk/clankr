import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigInput } from "../config/index.ts";
import { LmStudioClient } from "./client.ts";
import { LmStudioError, type LmStudioErrorKind } from "./errors.ts";
import {
  configForServer,
  FakeLmStudioServer,
  type FakeServerOptions,
  testSession,
} from "./fake-lm-studio-server.ts";
import { assertLoopbackHost } from "./loopback.ts";
import { ModelSwitcher } from "./model-switcher.ts";
import { oldServerWarning } from "./server-check.ts";
import { connectAtStartup } from "./startup.ts";
import { LmStudioTransport } from "./transport.ts";

const secretToken = "sk-lm-very-secret-token-0123456789";
const servers: FakeLmStudioServer[] = [];
const clients: LmStudioClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

interface StartupRun {
  error: LmStudioError | undefined;
  notices: string[];
}

async function runStartup(baseUrl: string, configInput: ConfigInput, modelKey = "test/a") {
  const config = configForServer(baseUrl, configInput);
  const client = new LmStudioClient({
    config,
    tokenCounter: { count: async () => 0, dispose: async () => {} },
  });
  clients.push(client);
  const switcher = new ModelSwitcher(client, config);
  const run: StartupRun = { error: undefined, notices: [] };
  try {
    await connectAtStartup({
      client,
      switcher,
      session: testSession(),
      modelKey,
      notify: (text) => run.notices.push(text),
    });
  } catch (error) {
    if (!(error instanceof LmStudioError)) throw error;
    run.error = error;
  }
  return run;
}

async function startFake(options: FakeServerOptions): Promise<string> {
  const server = new FakeLmStudioServer(options);
  servers.push(server);
  return server.start();
}

/** A port with nothing listening on it. */
async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

describe("startup errors (MOD-8)", () => {
  async function scenarios(): Promise<Record<string, StartupRun>> {
    const tokenServer = await startFake({
      requiredToken: secretToken,
      models: [{ key: "test/a" }],
    });
    const loadFailServer = await startFake({
      models: [{ key: "test/a" }],
      failingLoads: ["test/a"],
    });
    return {
      unreachable: await runStartup(await closedPortUrl(), {}),
      tokenMissing: await runStartup(tokenServer, {}),
      tokenRejected: await runStartup(tokenServer, {
        lmStudio: { apiToken: `${secretToken}-old` },
      }),
      notDownloaded: await runStartup(tokenServer, { lmStudio: { apiToken: secretToken } }, "x/y"),
      loadFailed: await runStartup(loadFailServer, { lmStudio: { apiToken: secretToken } }),
    };
  }

  it("detects each case distinctly, each with its own message and fix", async () => {
    const runs = await scenarios();
    const expectedKinds: Record<string, LmStudioErrorKind> = {
      unreachable: "server-unreachable",
      tokenMissing: "token-missing",
      tokenRejected: "token-rejected",
      notDownloaded: "model-not-downloaded",
      loadFailed: "model-load-failed",
    };
    for (const [name, kind] of Object.entries(expectedKinds)) {
      expect(runs[name]?.error?.kind, name).toBe(kind);
    }
    const errors = Object.values(runs).map((run) => run.error);
    expect(new Set(errors.map((error) => error?.message)).size).toBe(5);
    expect(new Set(errors.map((error) => error?.fix)).size).toBe(5);
    expect(runs.notDownloaded?.error?.message).toContain("test/a");
    expect(runs.loadFailed?.error?.message).toContain("insufficient memory");
  });

  it("never lets the token into an error, a notice, or a log", async () => {
    const logged: string[] = [];
    for (const method of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args.map(String).join(" "));
      });
    }
    try {
      const runs = await scenarios();
      const captured = Object.values(runs).flatMap((run) => [
        ...run.notices,
        run.error?.describe() ?? "",
        run.error?.stack ?? "",
      ]);
      expect(captured.join("\n")).not.toContain(secretToken);
      expect(logged.join("\n")).not.toContain(secretToken);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("warns about an LM Studio older than 0.4.0 and continues", async () => {
    const baseUrl = await startFake({ withoutV1Api: true });
    const run = await runStartup(baseUrl, {});
    expect(run.notices).toContain(oldServerWarning);
    // It continued past the warning and failed later, on the missing models endpoint.
    expect(run.error?.kind).toBe("request-failed");
  });

  it("starts on the default model when everything is in place", async () => {
    const baseUrl = await startFake({ requiredToken: secretToken, models: [{ key: "test/a" }] });
    const run = await runStartup(baseUrl, { lmStudio: { apiToken: secretToken } });
    expect(run.error).toBeUndefined();
  });
});

describe("loopback check (SEC-1)", () => {
  it("refuses a non-loopback base URL without the override", async () => {
    const run = await runStartup("http://192.168.1.20:1234", {});
    expect(run.error?.kind).toBe("host-not-allowed");
  });

  it("refuses a host name that resolves to a non-loopback address", async () => {
    const client = new LmStudioClient({
      config: configForServer("http://lmstudio.example:1234"),
      resolveHost: async () => ["127.0.0.1", "10.0.0.5"],
    });
    await expect(client.listModels()).rejects.toMatchObject({ kind: "host-not-allowed" });
  });

  it("accepts a non-loopback host only with the explicit override", async () => {
    // Checked at the transport, so the test never opens a connection to another host.
    const resolveHost = vi.fn(async () => ["10.0.0.5"]);
    const remote = "http://lmstudio.example:1234";
    const allowed = new LmStudioTransport({
      baseUrl: remote,
      allowNonLoopbackHost: true,
      resolveHost,
    });
    await expect(allowed.ensureHostAllowed()).resolves.toBeUndefined();
    expect(resolveHost).not.toHaveBeenCalled();
    const refused = new LmStudioTransport({
      baseUrl: remote,
      allowNonLoopbackHost: false,
      resolveHost,
    });
    await expect(refused.ensureHostAllowed()).rejects.toMatchObject({ kind: "host-not-allowed" });
  });

  it("accepts localhost, 127.x, ::1, and IPv4-mapped loopback", async () => {
    for (const baseUrl of ["http://127.0.0.2:1", "http://[::1]:1", "http://[::ffff:127.0.0.1]:1"]) {
      await expect(assertLoopbackHost(baseUrl), baseUrl).resolves.toBeUndefined();
    }
    await expect(
      assertLoopbackHost("http://localhost:1234", async () => ["::1", "127.0.0.1"]),
    ).resolves.toBeUndefined();
  });
});
