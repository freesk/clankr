import { describe, expect, it } from "vitest";
import { parseCliArguments } from "./arguments.ts";

describe("parseCliArguments", () => {
  it("reads the config subcommand, which takes no options", () => {
    expect(parseCliArguments(["config"])).toEqual({ ok: true, command: { kind: "config" } });
    expect(parseCliArguments(["config", "--model", "x"])).toEqual({
      ok: false,
      error: "config takes no arguments.",
    });
  });

  it("starts a session with no arguments", () => {
    expect(parseCliArguments([])).toEqual({
      ok: true,
      command: {
        kind: "session",
        prompt: undefined,
        json: false,
        allowData: false,
        ephemeral: false,
        resume: false,
        configFlags: { model: undefined, permissionMode: undefined, baseUrl: undefined },
      },
    });
  });

  it("reads one-shot flags", () => {
    const result = parseCliArguments([
      "-p",
      "sum the column",
      "--json",
      "--model",
      "qwen/qwen3-8b",
      "--permission-mode",
      "auto-edit",
      "--ephemeral",
      "--allow-data",
    ]);
    expect(result).toMatchObject({
      ok: true,
      command: {
        kind: "session",
        prompt: "sum the column",
        json: true,
        allowData: true,
        ephemeral: true,
        configFlags: { model: "qwen/qwen3-8b", permissionMode: "auto-edit" },
      },
    });
  });

  it("recognises wipe, help, and version", () => {
    expect(parseCliArguments(["wipe"])).toEqual({
      ok: true,
      command: { kind: "wipe", assumeYes: false },
    });
    expect(parseCliArguments(["wipe", "--yes"])).toMatchObject({ command: { assumeYes: true } });
    expect(parseCliArguments(["--help"])).toEqual({ ok: true, command: { kind: "help" } });
    expect(parseCliArguments(["-v"])).toEqual({ ok: true, command: { kind: "version" } });
  });

  it.each([
    [["--permission-mode", "yolo"], /--permission-mode must be one of/],
    [["--ephemeral", "--resume"], /cannot be combined/],
    [["hello"], /Unexpected argument "hello"/],
    [["--nope"], /nope/],
    [["wipe", "--json"], /wipe takes no arguments/],
    [["--yes"], /only applies to `clankr wipe`/],
    [["-p", "  "], /-p needs a prompt/],
  ])("rejects %j", (argv, message) => {
    const result = parseCliArguments(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});
