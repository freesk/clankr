// The whole-process network test (SEC-4, D33): run a command with both
// observers attached and report every destination other than LM Studio.
// Wave 2 points this at the real `vix` running a session that exercises
// every engine; the tests here point it at small scripts.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { type Destination, formatDestination, isAllowedDestination } from "./destinations.ts";
import { type ProxyRecord, startRecordingProxy } from "./recording-proxy.ts";
import { type SocketRecord, startSocketMonitor } from "./socket-monitor.ts";

export interface ObservedRunOptions {
  command: string;
  args: string[];
  /** The only allowed destination besides the proxy itself: the configured LM Studio address. */
  lmStudio: Destination;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  sampleIntervalMs?: number;
  /** The command is killed after this, and the run reports it as timed out. */
  timeoutMs?: number;
}

export interface Violation {
  observer: "proxy" | "socket-monitor";
  destination: string;
  detail: string;
}

export interface ObservedRun {
  exitCode: number | null;
  timedOut: boolean;
  proxyRecords: ProxyRecord[];
  sockets: SocketRecord[];
  violations: Violation[];
}

export async function runUnderObservation(options: ObservedRunOptions): Promise<ObservedRun> {
  const proxy = await startRecordingProxy([options.lmStudio]);
  const proxyDestination = { host: "127.0.0.1", port: proxy.port };
  try {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, ...proxyEnvironment(proxy.port) },
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (child.pid === undefined) throw new Error(`could not start ${options.command}`);
    const monitor = startSocketMonitor(child.pid, options.sampleIntervalMs ?? 50);
    const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 60_000);
    const [exitCode, signal] = (await once(child, "exit")) as [number | null, string | null];
    clearTimeout(timeout);
    const sockets = await monitor.stop();
    const allowed = [options.lmStudio, proxyDestination];
    return {
      exitCode,
      timedOut: signal === "SIGKILL",
      proxyRecords: proxy.records,
      sockets,
      violations: [...proxyViolations(proxy.records), ...socketViolations(sockets, allowed)],
    };
  } finally {
    await proxy.close();
  }
}

/** Every proxy variable a tool might read, in both spellings; nothing is exempt. */
function proxyEnvironment(port: number): NodeJS.ProcessEnv {
  const url = `http://127.0.0.1:${port}`;
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    ALL_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    all_proxy: url,
    NO_PROXY: "",
    no_proxy: "",
  };
}

function proxyViolations(records: ProxyRecord[]): Violation[] {
  return records
    .filter((record) => !record.allowed)
    .map((record) => ({
      observer: "proxy",
      destination: formatDestination(record),
      detail: `${record.method} request through the proxy`,
    }));
}

function socketViolations(sockets: SocketRecord[], allowed: Destination[]): Violation[] {
  return sockets
    .filter((socket) => !isAllowedDestination(socket.remote, allowed))
    .map((socket) => ({
      observer: "socket-monitor",
      destination: formatDestination(socket.remote),
      detail: `${socket.protocol} socket of process ${socket.pid}${socket.state ? ` (${socket.state})` : ""}`,
    }));
}

/** The number the metrics report shows as "outbound connections outside LM Studio". */
export function countOutboundDestinations(run: ObservedRun): number {
  return new Set(run.violations.map((violation) => violation.destination)).size;
}
