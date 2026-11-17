// Slash command dispatch (CLI-3). The cli owns /help, /exit, and /clear; every other
// command is registered by the part that owns the feature.

import type { SlashCommand, SlashCommandContext } from "../contracts/index.ts";

export interface BuiltinCommandActions {
  requestExit(): void;
  /** D32: a new session with empty context; the old one stays on disk. */
  startNewSession(): Promise<void>;
}

/** "/model x" is a command; "/Users/me/a.png" (a dragged path) is a prompt. */
export function isSlashCommand(line: string): boolean {
  return /^\/[a-z][\w-]*(\s|$)/i.test(line.trim());
}

export class SlashCommandDispatcher {
  private readonly commands: SlashCommand[];

  constructor(registered: readonly SlashCommand[], actions: BuiltinCommandActions) {
    this.commands = [...builtinCommands(actions, () => this.helpText()), ...registered];
    rejectDuplicateNames(this.commands);
  }

  names(): string[] {
    return this.commands.map((command) => command.name);
  }

  helpText(): string {
    const rows = this.commands.map((command) => ({
      usage: command.usage ?? `/${command.name}`,
      summary: command.summary,
    }));
    const width = Math.max(...rows.map((row) => row.usage.length));
    return rows.map((row) => `${row.usage.padEnd(width)}  ${row.summary}`).join("\n");
  }

  /** Runs the command a line names. An unknown command prints help instead. */
  async dispatch(line: string, context: SlashCommandContext): Promise<void> {
    const { name, argumentText } = splitCommandLine(line);
    const command = this.commands.find((candidate) => candidate.name === name);
    if (!command) {
      context.print(`Unknown command /${name}. Commands:\n${this.helpText()}`);
      return;
    }
    await command.run(argumentText, context);
  }
}

export function splitCommandLine(line: string): { name: string; argumentText: string } {
  const trimmed = line.trim().replace(/^\//, "");
  const spaceIndex = trimmed.search(/\s/);
  if (spaceIndex === -1) return { name: trimmed.toLowerCase(), argumentText: "" };
  return {
    name: trimmed.slice(0, spaceIndex).toLowerCase(),
    argumentText: trimmed.slice(spaceIndex).trim(),
  };
}

function builtinCommands(actions: BuiltinCommandActions, helpText: () => string): SlashCommand[] {
  return [
    {
      name: "help",
      summary: "List the slash commands",
      run: async (_argumentText, context) => context.print(helpText()),
    },
    {
      name: "clear",
      summary: "Start a new session with an empty context (the old one stays saved)",
      run: async (_argumentText, context) => {
        await actions.startNewSession();
        const note = context.session.ephemeral ? "" : " The previous one stays saved.";
        context.print(`Started a new session.${note}`);
      },
    },
    {
      name: "exit",
      summary: "Quit clankr",
      run: async () => actions.requestExit(),
    },
  ];
}

function rejectDuplicateNames(commands: readonly SlashCommand[]): void {
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.name)) {
      throw new Error(`Slash command /${command.name} is registered twice.`);
    }
    seen.add(command.name);
  }
}
