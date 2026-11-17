import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../contracts/index.ts";
import {
  createTemporaryVixPaths,
  FixedPathPolicy,
  InMemoryResultStore,
  QueuedApprovalPrompter,
  respond,
  ScriptedLmClient,
} from "./index.ts";

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("ScriptedLmClient", () => {
  it("replays responses in order and records requests", async () => {
    const client = new ScriptedLmClient([
      respond.text("hello"),
      respond.toolCall("list_dir", { path: "." }),
    ]);
    const signal = new AbortController().signal;

    const first = await collect(client.chat({ model: "m", messages: [] }, signal));
    expect(first[0]).toEqual({ type: "text", delta: "hello" });

    const second = await collect(client.chat({ model: "m", messages: [] }, signal));
    expect(second[0]).toMatchObject({
      type: "tool-call-delta",
      name: "list_dir",
      argumentsDelta: '{"path":"."}',
    });
    expect(client.requests).toHaveLength(2);
  });

  it("fails loudly when the script runs out", async () => {
    const client = new ScriptedLmClient();
    await expect(
      collect(client.chat({ model: "m", messages: [] }, new AbortController().signal)),
    ).rejects.toThrow(/no scripted response/);
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new ScriptedLmClient([respond.text("never")]);
    await expect(
      collect(client.chat({ model: "m", messages: [] }, controller.signal)),
    ).rejects.toThrow();
  });

  it("counts tokens from characters", async () => {
    const client = new ScriptedLmClient();
    expect(await client.countTokens([{ role: "user", content: "12345678" }])).toBe(2);
  });
});

describe("InMemoryResultStore", () => {
  it("stores text and reads line ranges", async () => {
    const store = new InMemoryResultStore();
    const handle = await store.putText("a\nb\nc\nd", { tool: "find_files", arguments: {} });
    expect(handle).toBe("r1");
    expect(await store.readText(handle, { startLine: 2, lineCount: 2 })).toBe("b\nc");
    expect((await store.describe(handle)).itemCount).toBe(4);
  });

  it("stores rows and reads them with a limit", async () => {
    const store = new InMemoryResultStore();
    const handle = await store.putRows([{ a: 1 }, { a: 2 }, { a: 3 }], {
      tool: "query_sql",
      arguments: {},
    });
    const rows = [];
    for await (const row of store.readRows(handle, 2)) rows.push(row);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect((await store.describe(handle)).columns).toEqual(["a"]);
  });
});

describe("QueuedApprovalPrompter", () => {
  it("answers from the queue", async () => {
    const prompter = new QueuedApprovalPrompter([{ kind: "deny", feedback: "no" }]);
    const request = {
      tool: { name: "delete", permission: "write" as const },
      preview: { summary: "Trash a.txt", targetPaths: ["/a.txt"] },
      reason: "delete always asks",
    };
    expect(await prompter.ask(request)).toEqual({ kind: "deny", feedback: "no" });
    await expect(prompter.ask(request)).rejects.toThrow(/no answer queued/);
  });
});

describe("FixedPathPolicy", () => {
  it("classifies allowed, outside, and denied paths case-insensitively", async () => {
    const policy = new FixedPathPolicy({
      allowedRoots: ["/work"],
      deniedPaths: ["/Users/me/.ssh"],
    });
    expect((await policy.classify("notes.md")).pathClass).toBe("allowed");
    expect((await policy.classify("/WORK/x")).pathClass).toBe("allowed");
    expect((await policy.classify("/workshop/x")).pathClass).toBe("outside");
    expect((await policy.classify("/users/me/.ssh/id_ed25519")).pathClass).toBe("denied");
  });
});

describe("createTemporaryVixPaths", () => {
  it("creates the session directories and removes them on cleanup", async () => {
    const { paths, cleanup } = await createTemporaryVixPaths();
    const { stat } = await import("node:fs/promises");
    expect((await stat(paths.session.results)).isDirectory()).toBe(true);
    await cleanup();
    await expect(stat(paths.root)).rejects.toThrow();
  });
});
