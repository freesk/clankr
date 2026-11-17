import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type IsolateLimits, ToolError } from "../../contracts/index.ts";
import { runInIsolate } from "./index.ts";

const limits: IsolateLimits = { timeoutMs: 1_000, memoryLimitMb: 32, rowCap: 100 };

describe("runInIsolate results", () => {
  it("returns the value of a bare expression", async () => {
    const result = await runInIsolate("[1, 2, 3].map((x) => x * 2)", {}, limits);
    expect(result).toEqual({ ok: true, value: [2, 4, 6], logs: [] });
  });

  it("returns the value of a return statement", async () => {
    const result = await runInIsolate("const total = 2 + 3;\nreturn { total };", {}, limits);
    expect(result).toEqual({ ok: true, value: { total: 5 }, logs: [] });
  });

  it("reports no value when the code returns nothing", async () => {
    const result = await runInIsolate("const unused = 1;", {}, limits);
    expect(result).toEqual({ ok: true, value: undefined, logs: [] });
  });

  it("captures console output in order", async () => {
    const result = await runInIsolate(
      'console.log("rows", 3, { a: 1 });\nconsole.warn("careful");\nreturn 1;',
      {},
      limits,
    );
    expect(result.logs).toEqual(['rows 3 {"a":1}', "warning: careful"]);
  });

  it("bounds console output so a logging loop cannot exhaust host memory", async () => {
    const result = await runInIsolate(
      'for (let i = 0; i < 20000; i++) console.log("x".repeat(50));',
      {},
      // A generous timeout: this checks the output bound, and 20,000 bridge calls can
      // take over a second on a busy machine.
      { ...limits, timeoutMs: 10_000 },
    );
    expect(result.ok).toBe(true);
    expect(result.logs.length).toBeLessThan(20_000);
    expect(result.logs.at(-1)).toBe("[more console output was dropped]");
  });
});

describe("runInIsolate errors", () => {
  it("reports a runtime error with the line in the model's code", async () => {
    const result = await runInIsolate("const rows = [];\nrows.missing.length;", {}, limits);
    expect(result).toEqual({
      ok: false,
      error: "TypeError: Cannot read properties of undefined (reading 'length') (line 2)",
      logs: [],
    });
  });

  it("reports a syntax error with its line and no host frames", async () => {
    const result = await runInIsolate("const a = 1;\nconst b = ;", {}, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("SyntaxError: Unexpected token ';' (line 2)");
  });

  it("reports a thrown non-error value", async () => {
    const result = await runInIsolate('throw "bad input";', {}, limits);
    expect(result).toMatchObject({ ok: false, error: "Uncaught bad input" });
  });

  it("reports a value that cannot become JSON", async () => {
    const result = await runInIsolate("const a = {}; a.self = a; return a;", {}, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^The returned value cannot be turned into JSON/);
  });

  it("keeps console output written before an error", async () => {
    const result = await runInIsolate(
      'console.log("before");\nthrow new Error("boom");',
      {},
      limits,
    );
    expect(result).toEqual({ ok: false, error: "Error: boom (line 2)", logs: ["before"] });
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await runInIsolate(
      "while (true) {}",
      {},
      { ...limits, timeoutMs: 5_000 },
      controller.signal,
    );
    expect(result).toMatchObject({ ok: false, error: "Cancelled before the code finished." });
  });

  it("does not start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runInIsolate("1", {}, limits, controller.signal);
    expect(result.ok).toBe(false);
  });
});

describe("runInIsolate helpers", () => {
  // On Node 26 with isolated-vm 7.0.2, stream I/O on the host never completes while the
  // isolate waits in a helper, so every data() on a stored row set timed out. That is why
  // clankr targets Node 24 (D77). This test catches the stall on any future upgrade.
  it("lets a helper finish when it waits on a real file stream", async () => {
    const thisFile = fileURLToPath(import.meta.url);
    const readLength = () =>
      new Promise<number>((resolve, reject) => {
        let length = 0;
        createReadStream(thisFile)
          .on("data", (chunk) => {
            length += chunk.length;
          })
          .on("end", () => resolve(length))
          .on("error", reject);
      });
    const started = Date.now();
    const result = await runInIsolate("fileLength()", { fileLength: readLength }, limits);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && typeof result.value === "number" && result.value > 0).toBe(true);
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("calls an async host helper synchronously from the model's side", async () => {
    const helpers = {
      double: async (value: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return (value as number) * 2;
      },
    };
    const result = await runInIsolate("double(4) + 1", helpers, limits);
    expect(result).toEqual({ ok: true, value: 9, logs: [] });
  });

  it("passes a ToolError's message to the model, at the caller's line", async () => {
    const helpers = {
      check: () => {
        throw new ToolError("check() needs a number.");
      },
    };
    const result = await runInIsolate('const x = 1;\ncheck("a");', helpers, limits);
    expect(result).toEqual({
      ok: false,
      error: "Error: check() needs a number. (line 2)",
      logs: [],
    });
  });

  it("hides the message of any other helper error", async () => {
    const helpers = {
      leak: () => {
        throw new Error("/Users/someone/secret.csv not found");
      },
    };
    const result = await runInIsolate("leak()", helpers, limits);
    expect(result).toMatchObject({
      ok: false,
      error: "Error: leak() failed unexpectedly. (line 1)",
    });
  });

  it("hands a helper copies, not references", async () => {
    let received: unknown;
    const helpers = {
      keep: (value: unknown) => {
        received = value;
        return { echoed: true };
      },
    };
    const result = await runInIsolate(
      "const v = { a: [1] }; keep(v); v.a.push(2); return v;",
      helpers,
      limits,
    );
    expect(received).toEqual({ a: [1] });
    expect(result).toMatchObject({ ok: true, value: { a: [1, 2] } });
  });

  it("rejects a helper name that would replace a built-in", async () => {
    await expect(runInIsolate("1", { console: () => 1 }, limits)).rejects.toThrow(/helper name/);
  });
});
