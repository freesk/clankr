// The second observer: samples the open internet sockets of a process and all
// its descendants with `ps` and `lsof`, and catches what bypasses the proxy.
// Short-lived connections can fall between samples; the proxy covers those.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Destination, parseEndpoint } from "./destinations.ts";

const run = promisify(execFile);

export interface SocketRecord {
  pid: number;
  protocol: string;
  remote: Destination;
  state?: string;
}

/** The process and every descendant, from one `ps` snapshot. */
export async function processTree(rootPid: number): Promise<number[]> {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid="]);
  const childrenOf = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || parentPid === undefined || Number.isNaN(pid)) continue;
    childrenOf.set(parentPid, [...(childrenOf.get(parentPid) ?? []), pid]);
  }
  const tree = [rootPid];
  for (let index = 0; index < tree.length; index++) {
    tree.push(...(childrenOf.get(tree[index] ?? -1) ?? []));
  }
  return tree;
}

/** Connected sockets only: listening and unconnected sockets have no remote end. */
export async function listConnectedSockets(pids: number[]): Promise<SocketRecord[]> {
  try {
    const { stdout } = await run("lsof", [
      "-a",
      "-n",
      "-P",
      "-i",
      "-p",
      pids.join(","),
      "-F",
      "pPnT",
    ]);
    return parseLsofFields(stdout);
  } catch (error) {
    // lsof exits with 1 when none of the processes has a matching socket.
    const output = (error as { stdout?: string }).stdout;
    if ((error as { code?: number }).code === 1) return parseLsofFields(output ?? "");
    throw error;
  }
}

/** Parses `lsof -F pPnT` output: one field per line, each prefixed by its letter. */
export function parseLsofFields(output: string): SocketRecord[] {
  const records: SocketRecord[] = [];
  let pid = 0;
  let current: Partial<SocketRecord> | undefined;
  const flush = () => {
    if (current?.remote && current.protocol) records.push({ pid, ...current } as SocketRecord);
    current = undefined;
  };
  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      flush();
      pid = Number(value);
    } else if (field === "f") {
      flush();
    } else if (field === "P") {
      flush();
      current = { protocol: value };
    } else if (field === "n" && current) {
      const remote = value.split("->")[1];
      if (remote) current.remote = parseEndpoint(remote);
    } else if (field === "T" && current && value.startsWith("ST=")) {
      current.state = value.slice(3);
    }
  }
  flush();
  return records;
}

export interface SocketMonitor {
  /** Every distinct connected socket seen in any sample so far. */
  observed(): SocketRecord[];
  /** Takes one last sample, then stops. */
  stop(): Promise<SocketRecord[]>;
}

export function startSocketMonitor(rootPid: number, intervalMs: number): SocketMonitor {
  const seen = new Map<string, SocketRecord>();
  let running = true;
  const sampleOnce = async () => {
    for (const record of await listConnectedSockets(await processTree(rootPid))) {
      seen.set(
        `${record.pid} ${record.protocol} ${record.remote.host}:${record.remote.port}`,
        record,
      );
    }
  };
  // A failed sample ends the loop and is rethrown by stop(), so it is never an unhandled rejection.
  let failure: unknown;
  const loop = (async () => {
    try {
      while (running) {
        await sampleOnce();
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    } catch (error) {
      failure = error;
    }
  })();
  return {
    observed: () => [...seen.values()],
    async stop() {
      running = false;
      await loop;
      if (failure) throw failure;
      await sampleOnce();
      return [...seen.values()];
    },
  };
}
