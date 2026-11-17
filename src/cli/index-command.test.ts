import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { IndexRequest, SlashCommandContext } from "../contracts/index.ts";
import { ScriptedLmClient } from "../testing/index.ts";
import { parseCliArguments } from "./arguments.ts";
import { exitCodes } from "./exit-codes.ts";
import type { CliComposition } from "./harness.ts";
import { parseIndexArgumentText } from "./index-arguments.ts";
import { createIndexSlashCommand } from "./index-command.ts";
import { runCli } from "./run-cli.ts";
import { createFakeComposition, createTestEnvironment } from "./testing/fake-harness.ts";

describe("clankr index arguments", () => {
  it.each<[string[], IndexRequest]>([
    [["index"], { action: "status" }],
    [["index", "--status"], { action: "status" }],
    [["index", "~/Documents"], { action: "build", folder: "~/Documents", rebuild: false }],
    [["index", "--rebuild", "notes"], { action: "build", folder: "notes", rebuild: true }],
    [["index", "notes", "--remove"], { action: "remove", folder: "notes" }],
  ])("reads %j", (argv, request) => {
    expect(parseCliArguments(argv)).toEqual({ ok: true, command: { kind: "index", request } });
  });

  it.each([
    [["index", "a", "b"], /index takes one folder/],
    [["index", "--yes"], /index takes one folder/],
    [["index", "--status", "notes"], /--status takes no folder/],
    [["index", "--remove"], /--remove needs a folder/],
    [["index", "--rebuild"], /--rebuild needs a folder/],
    [["index", "--remove", "--rebuild", "notes"], /only one of --rebuild, --remove/],
    [["--status"], /--status only applies to `clankr index`/],
    [["-p", "hi", "--rebuild"], /--rebuild only applies to `clankr index`/],
  ])("rejects %j", (argv, message) => {
    const result = parseCliArguments(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

describe("/index arguments", () => {
  it.each<[string, IndexRequest]>([
    ["", { action: "status" }],
    ["--status", { action: "status" }],
    ["~/My Documents", { action: "build", folder: "~/My Documents", rebuild: false }],
    ['"/Users/me/Tax 2025"', { action: "build", folder: "/Users/me/Tax 2025", rebuild: false }],
    ["/Users/me/Tax\\ 2025", { action: "build", folder: "/Users/me/Tax 2025", rebuild: false }],
    ["--rebuild notes", { action: "build", folder: "notes", rebuild: true }],
    ["--remove ~/old notes", { action: "remove", folder: "~/old notes" }],
  ])("reads %j", (text, request) => {
    expect(parseIndexArgumentText(text)).toEqual({ ok: true, request });
  });

  it("rejects an unknown option, but takes a quoted folder that starts with dashes", () => {
    expect(parseIndexArgumentText("--force notes")).toEqual({
      ok: false,
      error: "Unknown option --force. Use --status, --rebuild, or --remove.",
    });
    expect(parseIndexArgumentText('"--odd-folder"')).toMatchObject({
      request: { folder: "--odd-folder" },
    });
  });
});

describe("clankr index", () => {
  it("hands the request to the composition and prints what it reports", async () => {
    const composition = createFakeComposition({
      runIndexRequest: async (_request, options) => {
        options.print("Indexed ~/notes in 1 s.");
        return "done";
      },
    });
    const environment = createTestEnvironment({ argv: ["index", "notes"], composition });

    expect(await runCli(environment)).toBe(exitCodes.done);
    expect(composition.indexRequests).toEqual([
      { action: "build", folder: "notes", rebuild: false },
    ]);
    expect(environment.output()).toBe("Indexed ~/notes in 1 s.\n");
  });

  it("exits 1 when the request failed and 130 when it was cancelled", async () => {
    for (const [outcome, exitCode] of [
      ["failed", exitCodes.failed],
      ["cancelled", exitCodes.cancelled],
    ] as const) {
      const composition = createFakeComposition({ runIndexRequest: async () => outcome });
      const environment = createTestEnvironment({ argv: ["index", "notes"], composition });
      expect(await runCli(environment)).toBe(exitCode);
    }
  });

  it("aborts the run on Ctrl+C", async () => {
    let interrupt = () => {};
    const composition = createFakeComposition({
      runIndexRequest: (_request, options) =>
        new Promise((resolve) => {
          options.signal.addEventListener("abort", () => resolve("cancelled"));
          interrupt();
        }),
    });
    const environment = createTestEnvironment({ argv: ["index", "notes"], composition });
    interrupt = () => environment.interrupt();

    expect(await runCli(environment)).toBe(exitCodes.cancelled);
    expect(environment.forcedExitCode).toBeUndefined();
  });

  it("writes progress to stderr, never into the result on stdout", async () => {
    const composition = createFakeComposition({
      runIndexRequest: async (_request, options) => {
        options.showProgress({ filesDone: 1, filesTotal: 3, path: "a.md" });
        options.print("done");
        return "done";
      },
    });
    const environment = createTestEnvironment({ argv: ["index", "notes"], composition });
    await runCli(environment);
    expect(environment.errors()).toBe("Indexing: 1 of 3 files\n");
    expect(environment.output()).toBe("done\n");
  });

  it("reports an unexpected failure without the API token", async () => {
    const composition = createFakeComposition({
      runIndexRequest: async (_request, options) => {
        throw new Error(`boom ${options.config.lmStudio.apiToken}`);
      },
    });
    const environment = createTestEnvironment({ argv: ["index", "notes"], composition });
    environment.environment = { LM_API_TOKEN: "sk-lm-secret-token-123" };
    expect(await runCli(environment)).toBe(exitCodes.failed);
    expect(environment.errors()).toMatch(/^clankr: boom /);
    expect(environment.errors()).not.toContain("sk-lm-secret-token-123");
  });
});

describe("/index", () => {
  function slashContext(printed: string[], signal?: AbortSignal): SlashCommandContext {
    return {
      session: {
        id: "s",
        messages: [],
        model: undefined,
        permissionMode: "ask",
        grants: { tools: new Set(), dataFiles: new Set() },
        reasoning: "off",
        ephemeral: false,
      },
      config: defaultConfig(),
      lm: new ScriptedLmClient(),
      print: (text) => printed.push(text),
      ...(signal ? { signal } : {}),
    };
  }

  function command(composition: CliComposition, ephemeral = false) {
    return createIndexSlashCommand({ composition, workingDirectory: "/work", ephemeral });
  }

  it("runs the same request as the subcommand, with the REPL's cancel signal", async () => {
    const signals: AbortSignal[] = [];
    const composition = createFakeComposition({
      runIndexRequest: async (_request, options) => {
        signals.push(options.signal);
        options.print("Indexed.");
        return "done";
      },
    });
    const printed: string[] = [];
    const controller = new AbortController();

    await command(composition).run("--rebuild ~/notes", slashContext(printed, controller.signal));

    expect(composition.indexRequests).toEqual([
      { action: "build", folder: "~/notes", rebuild: true },
    ]);
    expect(signals).toEqual([controller.signal]);
    expect(printed).toEqual(["Indexed."]);
  });

  it("prints a usage problem instead of running", async () => {
    const composition = createFakeComposition();
    const printed: string[] = [];
    await command(composition).run("--remove", slashContext(printed));
    expect(printed).toEqual(["--remove needs a folder."]);
    expect(composition.indexRequests).toEqual([]);
  });

  it("lists indexes in an ephemeral session but refuses to change them (CLI-7)", async () => {
    const composition = createFakeComposition();
    const printed: string[] = [];
    await command(composition, true).run("~/notes", slashContext(printed));
    await command(composition, true).run("--remove ~/notes", slashContext(printed));
    await command(composition, true).run("", slashContext(printed));

    expect(printed).toEqual([
      expect.stringMatching(/ephemeral and leaves nothing on disk/),
      expect.stringMatching(/ephemeral and leaves nothing on disk/),
    ]);
    expect(composition.indexRequests).toEqual([{ action: "status" }]);
  });
});
