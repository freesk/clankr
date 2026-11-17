// Ephemeral sessions run in a child process here, because the exit paths under test
// (normal exit, signals, a hard kill) end the process that runs them.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ephemeralDirectory } from "./layout.ts";
import { openSession } from "./session.ts";

const storageModuleUrl = pathToFileURL(join(import.meta.dirname, "index.ts")).href;

// Opens an ephemeral session, stores a result and a scratch file, then leaves the way
// EXIT_MODE says. Prints the session directory so the test can check it existed.
const childScript = `
const { writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { openSession } = await import(process.env.STORAGE_URL);
const session = await openSession({ root: process.env.VIX_ROOT, ephemeral: true });
writeFileSync(join(session.paths.session.results, "r1.jsonl"), '{"salary":1}\\n');
writeFileSync(join(session.paths.session.scratch, "spill.tmp"), "spill");
process.stdout.write(session.paths.session.directory + "\\n");
const mode = process.env.EXIT_MODE;
if (mode === "cli-handles-sigint") process.on("SIGINT", () => process.exit(130));
if (mode === "exit") process.exit(0);
if (mode === "sigint" || mode === "cli-handles-sigint") process.kill(process.pid, "SIGINT");
if (mode === "sigterm") process.kill(process.pid, "SIGTERM");
if (mode === "crash") process.kill(process.pid, "SIGKILL");
if (mode !== "natural") setTimeout(() => {}, 10_000);
`;

function runChild(root: string, exitMode: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
    env: { ...process.env, STORAGE_URL: storageModuleUrl, VIX_ROOT: root, EXIT_MODE: exitMode },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { ...result, sessionDirectory: result.stdout.trim() };
}

/** Every path under the root with a hash of its content, so "unchanged" means byte for byte. */
async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  let names: string[];
  try {
    names = (await readdir(root, { recursive: true })).sort();
  } catch {
    return { "(root)": "missing" };
  }
  for (const name of names) {
    const path = join(root, name);
    const info = await stat(path);
    snapshot[name] = info.isDirectory()
      ? `dir ${info.mode & 0o777}`
      : createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
  }
  return snapshot;
}

let parent: string;
let root: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "vix-ephemeral-"));
  root = join(parent, ".vix");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function populateExistingRoot(): Promise<void> {
  const saved = await openSession({ root });
  await saved.transcript.appendMessage({ role: "user", content: "an earlier session" });
  await saved.close();
  await writeFile(join(root, "config.json"), '{"model":{}}');
}

describe("ephemeral session", () => {
  it.each(["natural", "exit", "sigint", "sigterm", "cli-handles-sigint"])(
    "leaves the tree byte-for-byte unchanged on exit path: %s",
    async (exitMode) => {
      await populateExistingRoot();
      const before = await snapshotTree(root);
      const child = runChild(root, exitMode);
      expect(child.stderr).toBe("");
      expect(child.sessionDirectory).toContain(ephemeralDirectory(root));
      expect(await snapshotTree(root)).toEqual(before);
    },
  );

  it("reports a signal exit as a signal exit", () => {
    expect(runChild(root, "sigterm").signal).toBe("SIGTERM");
    expect(runChild(root, "sigint").signal).toBe("SIGINT");
  });

  it("removes a root it had to create", async () => {
    runChild(root, "exit");
    await expect(stat(root)).rejects.toThrow();
  });

  it("writes no transcript and no logs", async () => {
    const session = await openSession({ root, ephemeral: true });
    await session.transcript.appendMessage({ role: "user", content: "secret" });
    expect(await readdir(root)).toEqual(["ephemeral"]);
    expect(await readdir(session.paths.session.directory)).not.toContain("transcript.jsonl");
    await session.close();
    await expect(stat(root)).rejects.toThrow();
  });

  it("sweeps a leftover from a crash at the next startup", async () => {
    await populateExistingRoot();
    const before = await snapshotTree(root);
    const crashed = runChild(root, "crash");
    expect(crashed.signal).toBe("SIGKILL");
    expect((await stat(crashed.sessionDirectory)).isDirectory()).toBe(true);

    const next = await openSession({ root });
    await next.close();
    await expect(stat(crashed.sessionDirectory)).rejects.toThrow();
    expect(await snapshotTree(root)).toEqual(before);
  });

  it("does not sweep the directory of a session that is still running", async () => {
    const running = await openSession({ root, ephemeral: true });
    const other = await openSession({ root });
    expect((await stat(running.paths.session.directory)).isDirectory()).toBe(true);
    await other.close();
    await running.close();
  });

  it("sweeps a directory whose name has no process id", async () => {
    const stray = join(ephemeralDirectory(root), "stray");
    await mkdir(stray, { recursive: true });
    const session = await openSession({ root });
    await session.close();
    await expect(stat(stray)).rejects.toThrow();
  });
});
