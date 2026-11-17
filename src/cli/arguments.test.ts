import { describe, expect, it } from "vitest";
import { parseCliArguments, usageText } from "./arguments.ts";

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

  it("reads --format for the REPL and for one-shot mode, whatever its case", () => {
    expect(parseCliArguments(["--format", "docx"])).toMatchObject({
      ok: true,
      command: { kind: "session", prompt: undefined, outputFormat: "docx" },
    });
    expect(parseCliArguments(["-p", "chart it", "--format", "XLSX"])).toMatchObject({
      ok: true,
      command: { prompt: "chart it", outputFormat: "xlsx" },
    });
    expect(parseCliArguments([])).toMatchObject({ command: { outputFormat: undefined } });
  });

  it("names every format in the usage text", () => {
    expect(usageText).toContain("--format <name>");
    expect(usageText).toContain("xlsx | docx | pdf | png | svg | csv");
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
    [["--format", "pptx"], /--format must be one of xlsx, docx, pdf, png, svg, csv\./],
    [["config", "--format", "pdf"], /config takes no arguments/],
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
