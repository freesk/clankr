// How the setup flow talks to the user. `clankr config` answers through readline, `/config`
// through the REPL's input line; the flow itself is the same for both.

export interface SetupPrompter {
  print(text: string): void;
  /**
   * Shows the question and returns the typed line, trimmed by the caller. Undefined means
   * the user cancelled (Ctrl+C, Esc, or the input ended). A secret answer is never echoed.
   */
  ask(question: string, options?: { secret?: boolean }): Promise<string | undefined>;
}

/** Thrown inside the flow when the user cancels; the flow turns it into "cancelled". */
export class SetupCancelled extends Error {
  override readonly name = "SetupCancelled";
}

/** Asks and returns the trimmed answer, or throws SetupCancelled. */
export async function askOrCancel(
  prompter: SetupPrompter,
  question: string,
  options?: { secret?: boolean },
): Promise<string> {
  const answer = await prompter.ask(question, options);
  if (answer === undefined) throw new SetupCancelled("Setup cancelled.");
  return answer.trim();
}

/** A yes/no question; Enter takes the default. */
export async function askYesNo(
  prompter: SetupPrompter,
  question: string,
  defaultAnswer: boolean,
): Promise<boolean> {
  const hint = defaultAnswer ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = (await askOrCancel(prompter, `${question} ${hint} `)).toLowerCase();
    if (answer === "") return defaultAnswer;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    prompter.print("Please answer y or n.");
  }
}

/** "Label [current]: ", the shape every step's question takes. */
export function withDefault(label: string, current: string): string {
  return `${label} [${current}]: `;
}
