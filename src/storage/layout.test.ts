import { describe, expect, it } from "vitest";
import { buildEphemeralVixPaths, buildVixPaths, newSessionId, resolveVixRoot } from "./layout.ts";

describe("resolveVixRoot", () => {
  it("defaults to ~/.vix", () => {
    expect(resolveVixRoot({}, "/Users/me")).toBe("/Users/me/.vix");
  });

  it("honours VIX_HOME, expanding ~", () => {
    expect(resolveVixRoot({ VIX_HOME: "/tmp/elsewhere" }, "/Users/me")).toBe("/tmp/elsewhere");
    expect(resolveVixRoot({ VIX_HOME: "~/alt" }, "/Users/me")).toBe("/Users/me/alt");
  });
});

describe("buildVixPaths", () => {
  it("follows the layout in specs/storage.md", () => {
    const paths = buildVixPaths("/r", "s1");
    expect(paths).toEqual({
      root: "/r",
      configFile: "/r/config.json",
      themeFile: "/r/theme.json",
      logsDirectory: "/r/logs",
      auditLog: "/r/logs/audit.jsonl",
      sessionsDirectory: "/r/sessions",
      session: {
        id: "s1",
        directory: "/r/sessions/s1",
        transcript: "/r/sessions/s1/transcript.jsonl",
        results: "/r/sessions/s1/results",
        snapshots: "/r/sessions/s1/snapshots",
        scratch: "/r/sessions/s1/tmp",
      },
    });
  });

  it("puts ephemeral sessions under ephemeral/<pid>-<id>", () => {
    expect(buildEphemeralVixPaths("/r", "s1", 42).session.directory).toBe("/r/ephemeral/42-s1");
  });

  it("rejects session ids that could escape the sessions directory", () => {
    expect(() => buildVixPaths("/r", "../etc")).toThrow(/Invalid session id/);
    expect(() => buildVixPaths("/r", "")).toThrow(/Invalid session id/);
  });

  it("creates ids that sort by creation time", () => {
    const earlier = newSessionId(new Date("2026-01-02T03:04:05Z"));
    const later = newSessionId(new Date("2026-11-17T00:00:00Z"));
    expect(earlier).toMatch(/^20260102-030405-[0-9a-f]{6}$/);
    expect(earlier < later).toBe(true);
  });
});
