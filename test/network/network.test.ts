// The network test harness catches a deliberate outbound connection through
// either observer, and passes a process that talks only to LM Studio.
// "Outside" here is a second loopback server: any destination other than the
// LM Studio address is a violation, and nothing really leaves the machine.

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countOutboundDestinations, parseLsofFields, runUnderObservation } from "./index.ts";

const hasLsof = (() => {
  try {
    execFileSync("which", ["lsof"]);
    return true;
  } catch {
    return false;
  }
})();

interface LocalServer {
  port: number;
  close(): Promise<void>;
}

async function startHttpServer(): Promise<LocalServer> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((_request, response) => response.end("ok"));
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const holdMs = 600;

/** Opens a raw socket and keeps it open long enough to be sampled. */
const holdSocketScript = (port: number) =>
  `const s=require("net").connect(${port},"127.0.0.1",()=>setTimeout(()=>s.end(),${holdMs}));`;

/** A proxy-honouring request, the way a well-behaved HTTP client uses HTTP_PROXY. */
const proxiedGetScript = (absoluteUrl: string) => `
  const proxy=new URL(process.env.HTTP_PROXY);
  require("http").get({host:proxy.hostname,port:proxy.port,path:${JSON.stringify(absoluteUrl)}},
    (response)=>{console.log("proxied status",response.statusCode);response.resume();});`;

function node(script: string) {
  return { command: process.execPath, args: ["-e", script] };
}

describe.skipIf(!hasLsof)("whole-process network test", () => {
  let lmStudio: LocalServer;
  let outside: LocalServer;

  beforeAll(async () => {
    lmStudio = await startHttpServer();
    outside = await startHttpServer();
  });

  afterAll(async () => {
    await lmStudio.close();
    await outside.close();
  });

  const observe = (script: string) =>
    runUnderObservation({
      ...node(script),
      lmStudio: { host: "localhost", port: lmStudio.port },
      sampleIntervalMs: 25,
      timeoutMs: 10_000,
    });

  it("passes a process that talks only to LM Studio, directly and through the proxy", async () => {
    const run = await observe(
      holdSocketScript(lmStudio.port) +
        proxiedGetScript(`http://127.0.0.1:${lmStudio.port}/v1/models`),
    );
    expect(run.exitCode).toBe(0);
    expect(run.violations).toEqual([]);
    // Neither observer is blind: each saw the allowed traffic.
    expect(run.sockets.some((socket) => socket.remote.port === lmStudio.port)).toBe(true);
    expect(run.proxyRecords).toEqual([
      { host: "127.0.0.1", port: lmStudio.port, method: "http", allowed: true },
    ]);
  });

  it("fails when a process opens a socket to anywhere else (socket monitor)", async () => {
    const run = await observe(holdSocketScript(outside.port));
    expect(run.violations).toContainEqual(
      expect.objectContaining({
        observer: "socket-monitor",
        destination: `127.0.0.1:${outside.port}`,
      }),
    );
    expect(countOutboundDestinations(run)).toBe(1);
  });

  it("fails when a process asks the proxy for anywhere else, and the request is refused (proxy)", async () => {
    const run = await observe(proxiedGetScript("http://telemetry.example/collect"));
    expect(run.violations).toEqual([
      {
        observer: "proxy",
        destination: "telemetry.example:80",
        detail: "http request through the proxy",
      },
    ]);
    expect(run.proxyRecords[0]?.allowed).toBe(false);
  });

  it("catches a connection from a grandchild process", async () => {
    const grandchild = holdSocketScript(outside.port);
    const run = await observe(`
      const child=require("child_process").spawn(process.execPath,["-e",${JSON.stringify(grandchild)}],{stdio:"inherit"});
      child.on("exit",()=>process.exit(0));`);
    const violation = run.violations.find((candidate) => candidate.observer === "socket-monitor");
    expect(violation?.destination).toBe(`127.0.0.1:${outside.port}`);
  });
});

describe("parseLsofFields", () => {
  it("keeps connected sockets and drops listening and unconnected ones", () => {
    const output = [
      "p501",
      "f12",
      "PTCP",
      "n127.0.0.1:63034->127.0.0.1:1234",
      "TST=ESTABLISHED",
      "TQR=0",
      "f13",
      "PTCP",
      "n192.168.1.226:63035->192.0.2.1:9",
      "TST=SYN_SENT",
      "f14",
      "PUDP",
      "n*:57146",
      "p502",
      "f20",
      "PTCP",
      "n[::1]:5000->[::1]:6000",
      "f21",
      "PTCP",
      "n*:7000",
      "TST=LISTEN",
    ].join("\n");
    expect(parseLsofFields(output)).toEqual([
      {
        pid: 501,
        protocol: "TCP",
        remote: { host: "127.0.0.1", port: 1234 },
        state: "ESTABLISHED",
      },
      { pid: 501, protocol: "TCP", remote: { host: "192.0.2.1", port: 9 }, state: "SYN_SENT" },
      { pid: 502, protocol: "TCP", remote: { host: "::1", port: 6000 } },
    ]);
  });
});
