// Turns the command line into one command. Knows nothing about what the commands do.

import { parseArgs } from "node:util";
import type { ConfigFlags } from "../config/index.ts";
import type { PermissionMode } from "../contracts/index.ts";

export interface SessionCommand {
  kind: "session";
  /** Set by `-p`. Without it, the REPL starts unless stdin is piped. */
  prompt: string | undefined;
  json: boolean;
  ephemeral: boolean;
  resume: boolean;
  configFlags: ConfigFlags;
}

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "wipe"; assumeYes: boolean }
  | { kind: "config" }
  | SessionCommand;

export type ParseResult = { ok: true; command: CliCommand } | { ok: false; error: string };

const permissionModes: readonly PermissionMode[] = ["ask", "auto-edit", "read-only"];

export const usageText = `Usage:
  vix [options]              Start the interactive REPL
  vix -p "prompt" [options]  Run one prompt and exit (stdin may be piped in)
  vix wipe [--yes]           Delete all saved sessions, stored results, and logs
  vix config                 Set up the LM Studio address, API token, model, and preferences

Options:
  -p, --print <prompt>       One-shot mode: print the result and exit
      --json                 One-shot output as JSON, for scripts
      --model <key>          Model to use instead of the configured default
      --permission-mode <m>  ask | auto-edit | read-only, for this run
      --base-url <url>       LM Studio address instead of the configured one
      --ephemeral            Leave nothing on disk when the session ends
      --resume               Reopen the most recent saved session
  -y, --yes                  With wipe: do not ask for confirmation
  -v, --version              Print the version
  -h, --help                 Print this help

Exit status: 0 done, 1 failed or denied, 2 usage error, 130 cancelled.`;

const optionSpecification = {
  print: { type: "string", short: "p" },
  json: { type: "boolean" },
  model: { type: "string" },
  "permission-mode": { type: "string" },
  "base-url": { type: "string" },
  ephemeral: { type: "boolean" },
  resume: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

type ParsedValues = ReturnType<typeof parseValues>["values"];

function parseValues(argv: string[]) {
  return parseArgs({ args: argv, options: optionSpecification, allowPositionals: true });
}

export function parseCliArguments(argv: string[]): ParseResult {
  let parsed: ReturnType<typeof parseValues>;
  try {
    parsed = parseValues(argv);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  if (values.help) return { ok: true, command: { kind: "help" } };
  if (values.version) return { ok: true, command: { kind: "version" } };
  if (positionals[0] === "wipe") return parseWipe(values, positionals);
  if (positionals[0] === "config") return parseConfig(values, positionals);
  if (positionals.length > 0) {
    return {
      ok: false,
      error: `Unexpected argument "${positionals[0]}". Use -p to pass a prompt.`,
    };
  }
  return parseSession(values);
}

function parseWipe(values: ParsedValues, positionals: string[]): ParseResult {
  const otherOptions = Object.keys(values).filter((name) => name !== "yes");
  if (positionals.length > 1 || otherOptions.length > 0) {
    return { ok: false, error: "wipe takes no arguments other than --yes." };
  }
  return { ok: true, command: { kind: "wipe", assumeYes: values.yes === true } };
}

function parseConfig(values: ParsedValues, positionals: string[]): ParseResult {
  if (positionals.length > 1 || Object.keys(values).length > 0) {
    return { ok: false, error: "config takes no arguments." };
  }
  return { ok: true, command: { kind: "config" } };
}

function parseSession(values: ParsedValues): ParseResult {
  if (values.yes) return { ok: false, error: "--yes only applies to `vix wipe`." };
  if (values.ephemeral && values.resume) {
    return { ok: false, error: "--ephemeral and --resume cannot be combined." };
  }
  const permissionMode = values["permission-mode"];
  if (permissionMode !== undefined && !isPermissionMode(permissionMode)) {
    return {
      ok: false,
      error: `--permission-mode must be one of ${permissionModes.join(", ")}.`,
    };
  }
  if (values.print !== undefined && values.print.trim() === "") {
    return { ok: false, error: "-p needs a prompt." };
  }
  return {
    ok: true,
    command: {
      kind: "session",
      prompt: values.print,
      json: values.json === true,
      ephemeral: values.ephemeral === true,
      resume: values.resume === true,
      configFlags: {
        model: values.model,
        permissionMode,
        baseUrl: values["base-url"],
      },
    },
  };
}

function isPermissionMode(value: string): value is PermissionMode {
  return (permissionModes as readonly string[]).includes(value);
}
