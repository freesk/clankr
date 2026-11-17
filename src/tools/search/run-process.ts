// Runs a fixed binary (mdfind, mdutil, ripgrep) with an argument array and streams its
// output record by record. Never a shell, and never a command string built from model
// input: arguments reach the binary exactly as given (PERM-6 in spirit).

import { spawn } from "node:child_process";

export interface ProcessRun {
  exitCode: number | null;
  /** True when the consumer asked to stop early and the process was killed. */
  stopped: boolean;
  /** The first few KB of standard error, for error messages. */
  stderr: string;
}

export interface RunOptions {
  signal: AbortSignal;
  /** Record separator in standard output. */
  separator?: "\n" | "\0";
  /** Called for each record. Return false to stop reading and kill the process. */
  onRecord(record: string): boolean | undefined;
}

const maxStderrCharacters = 4096;

export function runProcess(
  binary: string,
  args: string[],
  options: RunOptions,
): Promise<ProcessRun> {
  const separator = options.separator ?? "\n";
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    let pending = "";
    let stopped = false;
    let stderr = "";

    const deliver = (record: string): void => {
      if (stopped || record === "") return;
      if (options.onRecord(record) === false) {
        stopped = true;
        child.kill();
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stopped) return;
      pending += chunk;
      const records = pending.split(separator);
      pending = records.pop() ?? "";
      for (const record of records) deliver(record);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < maxStderrCharacters) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      deliver(pending);
      resolve({ exitCode, stopped, stderr: stderr.slice(0, maxStderrCharacters) });
    });
  });
}

/** Runs a binary to completion and returns its whole standard output. */
export async function runForOutput(
  binary: string,
  args: string[],
  signal: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const lines: string[] = [];
  const run = await runProcess(binary, args, {
    signal,
    onRecord: (line) => {
      lines.push(line);
      return true;
    },
  });
  return { exitCode: run.exitCode, stdout: lines.join("\n"), stderr: run.stderr };
}
