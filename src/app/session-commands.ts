// Slash commands bound to one session (`/context`, `/compact`, `/undo`) must follow `/clear`
// to the new session, while the cli registers its commands once. Each command here is a
// stable stand-in that runs the current session's command of the same name, then saves.

import type { SlashCommand } from "../contracts/index.ts";
import type { ActiveSession } from "./active-session.ts";

export function sessionCommandsFor(
  firstSessionCommands: readonly SlashCommand[],
  currentSession: () => ActiveSession,
): SlashCommand[] {
  return firstSessionCommands.map((first) => ({
    name: first.name,
    summary: first.summary,
    ...(first.usage ? { usage: first.usage } : {}),
    async run(argumentText, context) {
      const session = currentSession();
      const command = session.runtime.slashCommands.find(
        (candidate) => candidate.name === first.name,
      );
      if (!command) throw new Error(`/${first.name} is not available in this session.`);
      await command.run(argumentText, context);
      // `/compact` replaces the history; the transcript records that now, not at the next turn.
      await session.save();
    },
  }));
}
