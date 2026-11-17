// The isolation guarantees in specs/sandbox.md, "Done when". Every test here runs with the host's
// network entry points watched, and the last test asserts none was touched (SEC-4).

import dns from "node:dns";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from "vitest";
import type { IsolateLimits } from "../../contracts/index.ts";
import { createTestToolContext, InMemoryResultStore } from "../../testing/index.ts";
import { runJsTool } from "../../tools/data/run-js.ts";
import { createStandardHelpers, runInIsolate } from "./index.ts";

const limits: IsolateLimits = { timeoutMs: 500, memoryLimitMb: 32, rowCap: 1_000 };

let networkSpies: MockInstance[] = [];

beforeAll(() => {
  networkSpies = [
    vi.spyOn(net.Socket.prototype, "connect"),
    vi.spyOn(dns, "lookup"),
    vi.spyOn(dns.promises, "lookup"),
    vi.spyOn(globalThis, "fetch"),
  ];
});

afterAll(() => {
  for (const spy of networkSpies) spy.mockRestore();
});

async function runWithStandardHelpers(code: string, results = new InMemoryResultStore()) {
  return await runInIsolate(code, createStandardHelpers(results, limits), limits);
}

describe("escape attempts fail inside the isolate", () => {
  // [label, code, the error the model sees]
  const attempts: [string, string, RegExp][] = [
    ["process", "process.exit(1)", /^ReferenceError: process is not defined/],
    [
      "require",
      'require("fs").readFileSync("/etc/passwd", "utf8")',
      /^ReferenceError: require is not defined/,
    ],
    ["dynamic import", 'return await import("node:fs");', /^Error: Not supported/],
    ["fetch", 'return await fetch("http://example.com")', /^ReferenceError: fetch is not defined/],
    [
      "constructor chain from a helper",
      'data.constructor("return process")().exit(1)',
      /^ReferenceError: process is not defined/,
    ],
    [
      "constructor chain from globalThis",
      'this.constructor.constructor("return process")().pid',
      /^ReferenceError: process is not defined/,
    ],
    [
      "constructor chain from console",
      'console.log.constructor("return require")()("fs")',
      /^ReferenceError: require is not defined/,
    ],
    ["the host's module globals", "module.exports", /^ReferenceError: module is not defined/],
  ];

  it.each(attempts)("%s", async (_label, code, expectedError) => {
    const result = await runWithStandardHelpers(code);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(expectedError) });
  });

  it("sees no host API names on the global object", async () => {
    const result = await runWithStandardHelpers(
      "['process', 'require', 'fetch', 'module', 'Buffer', 'setTimeout', 'XMLHttpRequest', 'WebSocket'].filter((name) => typeof globalThis[name] !== 'undefined')",
    );
    expect(result).toEqual({ ok: true, value: [], logs: [] });
  });

  it("gets no host function from a helper's result", async () => {
    const result = await runWithStandardHelpers(
      'const handle = save("x", [{ a: 1 }]); return [typeof handle, Object.getPrototypeOf(data(handle)[0]) === Object.prototype];',
    );
    expect(result).toEqual({ ok: true, value: ["string", true], logs: [] });
  });
});

describe("limits stop runaway code and the harness survives", () => {
  it("stops an infinite loop", async () => {
    const started = Date.now();
    const result = await runWithStandardHelpers("while (true) {}");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Stopped: the code ran longer than 0.5 s/),
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("stops a promise that never settles", async () => {
    const result = await runWithStandardHelpers("await new Promise(() => {});");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Stopped: the code ran longer/),
    });
  });

  it("stops an endless chain of microtasks", async () => {
    const result = await runWithStandardHelpers("while (true) { await null; }");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Stopped: the code ran longer/),
    });
  });

  it("stops unbounded allocation at the memory limit", async () => {
    const result = await runWithStandardHelpers(
      "const chunks = []; while (true) chunks.push(new Array(100000).fill(Math.random()));",
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Stopped: the code used more than 32 MB of memory/),
    });
  });

  it("stops unbounded string growth at the memory limit", async () => {
    const result = await runWithStandardHelpers(
      'let text = "x"; const parts = []; while (true) { text += text.length < 1e6 ? text : ""; parts.push(text + parts.length); }',
    );
    expect(result.ok).toBe(false);
  });

  it("keeps working after every runaway above", async () => {
    const result = await runWithStandardHelpers("1 + 1");
    expect(result).toEqual({ ok: true, value: 2, logs: [] });
  });
});

describe("no state survives between calls", () => {
  it("does not keep globals or prototype changes", async () => {
    await runWithStandardHelpers(
      'globalThis.leaked = 42; Array.prototype.sneaky = 1; Object.prototype.polluted = "yes";',
    );
    const result = await runWithStandardHelpers(
      "[typeof leaked, typeof [].sneaky, typeof ({}).polluted]",
    );
    expect(result).toEqual({ ok: true, value: ["undefined", "undefined", "undefined"], logs: [] });
  });

  it("shares a saved row set only through its handle", async () => {
    const results = new InMemoryResultStore();
    const first = await runWithStandardHelpers(
      'const handle = save("kept", [{ v: 1 }]); globalThis.rows = data(handle); return handle;',
      results,
    );
    expect(first).toMatchObject({ ok: true, value: "r1" });
    const second = await runWithStandardHelpers('[typeof rows, data("r1")]', results);
    expect(second).toEqual({ ok: true, value: ["undefined", [{ v: 1 }]], logs: [] });
  });
});

describe("over-cap output", () => {
  it("returns a preview and a handle to the full rows", async () => {
    const { context, cleanup } = await createTestToolContext();
    try {
      const code = "Array.from({ length: 5000 }, (_, i) => ({ i, label: 'row ' + i }))";
      const output = await runJsTool.run({ code }, context);
      expect(output.handles).toEqual(["r1"]);
      expect(output.text.split("\n")).toHaveLength(22);
      const stored = [];
      for await (const row of context.results.readRows("r1")) stored.push(row);
      expect(stored).toHaveLength(5000);
      expect(stored[4999]).toEqual({ i: 4999, label: "row 4999" });
    } finally {
      await cleanup();
    }
  });
});

describe("network", () => {
  it("was never touched by anything above", () => {
    for (const spy of networkSpies) expect(spy).not.toHaveBeenCalled();
  });

  // Proves the watch above can see a connection, so its silence means something.
  it("would have seen a connection attempt", () => {
    const socket = new net.Socket();
    socket.on("error", () => {});
    socket.connect({ host: "127.0.0.1", port: 9 });
    socket.destroy();
    expect(networkSpies[0]).toHaveBeenCalled();
  });
});
