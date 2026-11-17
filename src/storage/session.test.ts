import { lstat, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildVixPaths } from "./layout.ts";
import { openSession } from "./session.ts";
import { chooseResumeModel, FileSessionStore } from "./session-store.ts";

// Every test works in a fresh temporary root: the real ~/.vix is never touched.
let root: string;

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), "vix-storage-")), ".vix");
});

afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

async function modesUnder(directory: string): Promise<Map<string, number>> {
  const modes = new Map<string, number>([[directory, (await lstat(directory)).mode & 0o777]]);
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isDirectory()) for (const [key, mode] of await modesUnder(path)) modes.set(key, mode);
    else modes.set(path, info.mode & 0o777);
  }
  return modes;
}

async function saveSession(text: string): Promise<string> {
  const session = await openSession({ root });
  await session.transcript.appendMessage({ role: "user", content: text });
  await session.close();
  return session.paths.session.id;
}

describe("openSession", () => {
  it("creates every directory as 0700 and every file as 0600, whatever the umask", async () => {
    const previousUmask = process.umask(0o000);
    try {
      const session = await openSession({ root });
      await session.transcript.appendMessage({ role: "user", content: "hi" });
      await writeFile(join(session.paths.session.results, "r1.txt"), "x");
      const modes = await modesUnder(root);
      const transcriptMode = modes.get(session.paths.session.transcript);
      expect(transcriptMode).toBe(0o600);
      for (const [path, mode] of modes) {
        if ((await lstat(path)).isDirectory()) expect([path, mode]).toEqual([path, 0o700]);
      }
    } finally {
      process.umask(previousUmask);
    }
  });

  it("removes a session that recorded nothing when it closes", async () => {
    const session = await openSession({ root });
    await session.close();
    await expect(stat(session.paths.session.directory)).rejects.toThrow();
  });

  it("keeps a session that has a transcript", async () => {
    const id = await saveSession("hello");
    expect((await stat(buildVixPaths(root, id).session.transcript)).isFile()).toBe(true);
  });

  it("writes messages and model changes in call order without awaiting each", async () => {
    const session = await openSession({ root });
    const writes = [
      session.transcript.appendMessage({ role: "user", content: "one" }),
      session.transcript.recordModel("model/a"),
      session.transcript.appendMessage({ role: "assistant", content: "two" }),
    ];
    await Promise.all(writes);
    const saved = await new FileSessionStore(root).load(session.paths.session.id);
    expect(saved.messages.map((message) => message.content)).toEqual(["one", "two"]);
    expect(saved.modelKey).toBe("model/a");
    expect(saved.createdAt).toMatch(/^\d{4}-/);
  });
});

describe("FileSessionStore", () => {
  it("opens the most recently active of three sessions", async () => {
    const ids = [
      await saveSession("first"),
      await saveSession("second"),
      await saveSession("third"),
    ];
    // Make the first session the most recently written, regardless of its id.
    const future = new Date(Date.now() + 60_000);
    await utimes(buildVixPaths(root, ids[0] ?? "").session.transcript, future, future);

    const store = new FileSessionStore(root);
    const newest = await store.newest();
    expect(newest?.id).toBe(ids[0]);
    expect(newest?.messages).toEqual([{ role: "user", content: "first" }]);
    expect((await store.list()).map((summary) => summary.id)).toEqual([ids[0], ids[2], ids[1]]);
  });

  it("has no newest session when nothing is saved", async () => {
    expect(await new FileSessionStore(root).newest()).toBeUndefined();
  });

  it("skips a line cut short by a crash", async () => {
    const id = await saveSession("kept");
    await writeFile(buildVixPaths(root, id).session.transcript, '{"type":"mess', { flag: "a" });
    const saved = await new FileSessionStore(root).load(id);
    expect(saved.messages).toEqual([{ role: "user", content: "kept" }]);
  });

  it("refuses ids that are not plain session ids", async () => {
    await expect(new FileSessionStore(root).load("../../etc")).rejects.toThrow(/No saved session/);
  });
});

describe("resume", () => {
  it("reuses the session directory, so results stored before the restart still resolve", async () => {
    const first = await openSession({ root });
    await first.transcript.appendMessage({ role: "user", content: "query the payroll" });
    const resultFile = join(first.paths.session.results, "r1.jsonl");
    await writeFile(resultFile, '{"a":1}\n');
    await first.close();

    const saved = await new FileSessionStore(root).newest();
    const resumed = await openSession({ root, resumeSessionId: saved?.id ?? "" });
    expect(resumed.paths.session.results).toBe(first.paths.session.results);
    expect((await stat(resultFile)).isFile()).toBe(true);
    await resumed.transcript.appendMessage({ role: "assistant", content: "done" });

    const reloaded = await new FileSessionStore(root).load(resumed.paths.session.id);
    expect(reloaded.messages).toHaveLength(2);
  });

  it("falls back to the default model, and says so, when the saved one is gone", () => {
    expect(chooseResumeModel("a", ["a", "b"], "b")).toEqual({ modelKey: "a" });
    expect(chooseResumeModel(undefined, [], "b")).toEqual({ modelKey: "b" });
    const fallback = chooseResumeModel("gone", ["b"], "b");
    expect(fallback.modelKey).toBe("b");
    expect(fallback.notice).toMatch(/"gone" is no longer available/);
  });

  it("cannot be combined with ephemeral mode", async () => {
    await expect(openSession({ root, ephemeral: true, resumeSessionId: "x" })).rejects.toThrow(
      /ephemeral/,
    );
  });
});
