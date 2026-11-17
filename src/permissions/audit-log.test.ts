import { readdir, readFile, stat } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry } from "../contracts/index.ts";
import { createTemporaryVixPaths, type TemporaryVixPaths } from "../testing/index.ts";
import { createAuditLog, maxLoggedStringLength } from "./audit-log.ts";

let temporary: TemporaryVixPaths;

beforeEach(async () => {
  temporary = await createTemporaryVixPaths();
});

afterEach(async () => {
  await temporary.cleanup();
});

const token = 'sk-"secret/token';

const scriptedCalls: AuditEntry[] = [
  {
    tool: "find_files",
    arguments: { pattern: "*.pdf" },
    decision: "allowed",
    basis: "read",
    outcome: "ok",
  },
  { tool: "write_file", arguments: { path: "/w/a.md" }, decision: "denied", outcome: "not-run" },
  {
    tool: "query_sql",
    arguments: { sql: `SELECT '${token}'` },
    decision: "allowed",
    basis: "approved-for-session",
    outcome: "error",
    error: `failed near ${token}`,
    durationMs: 12,
  },
];

async function readLines(): Promise<Record<string, unknown>[]> {
  const text = await readFile(temporary.paths.auditLog, "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("audit log", () => {
  it("writes one line per call with time, tool, arguments, decision, and outcome", async () => {
    const log = createAuditLog({ vixPaths: temporary.paths, ephemeral: false, secrets: [] });
    for (const entry of scriptedCalls.slice(0, 2)) await log.record(entry);
    const lines = await readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      tool: "find_files",
      arguments: { pattern: "*.pdf" },
      decision: "allowed",
      outcome: "ok",
    });
    expect(lines[0]?.time).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await stat(temporary.paths.auditLog)).mode & 0o777).toBe(0o600);
  });

  it("never writes the API token, even JSON-escaped", async () => {
    const log = createAuditLog({
      vixPaths: temporary.paths,
      ephemeral: false,
      secrets: [token, undefined],
    });
    for (const entry of scriptedCalls) await log.record(entry);
    const text = await readFile(temporary.paths.auditLog, "utf8");
    expect(text).not.toContain("secret/token");
    expect(text).toContain("[redacted]");
    expect(text.trim().split("\n")).toHaveLength(3);
  });

  it("shortens very long arguments", async () => {
    const log = createAuditLog({ vixPaths: temporary.paths, ephemeral: false, secrets: [] });
    const content = "x".repeat(maxLoggedStringLength + 500);
    await log.record({
      tool: "write_file",
      arguments: { content },
      decision: "allowed",
      outcome: "ok",
    });
    const [line] = await readLines();
    expect(line?.arguments).toEqual({
      content: expect.stringMatching(/^x{2000}… \[500 more characters\]$/),
    });
  });

  it("keeps lines in call order without awaiting each", async () => {
    const log = createAuditLog({ vixPaths: temporary.paths, ephemeral: false, secrets: [] });
    await Promise.all(scriptedCalls.map((entry) => log.record(entry)));
    expect((await readLines()).map((line) => line.tool)).toEqual(
      scriptedCalls.map((entry) => entry.tool),
    );
  });

  it("writes nothing in an ephemeral session", async () => {
    const log = createAuditLog({ vixPaths: temporary.paths, ephemeral: true, secrets: [] });
    for (const entry of scriptedCalls) await log.record(entry);
    expect(await readdir(temporary.paths.logsDirectory)).toEqual([]);
  });
});
