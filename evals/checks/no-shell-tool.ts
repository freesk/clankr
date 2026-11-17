// PERM-6: the registry has no shell tool. Checked by name against the tool
// list, so a tool that would let the model run arbitrary commands is caught
// however it is spelled: run_shell, bash, execCommand, terminal, and so on.

/** Name parts that mean "run a command on the host". `run` and `js` alone are fine. */
const shellWords = new Set([
  "shell",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "tcsh",
  "dash",
  "terminal",
  "tty",
  "pty",
  "console",
  "cmd",
  "command",
  "commands",
  "exec",
  "execute",
  "subprocess",
  "spawn",
  "popen",
  "powershell",
  "pwsh",
  "osascript",
  "applescript",
]);

/** Splits snake_case, kebab-case, dotted, and camelCase names into lower-case words. */
export function toolNameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function isShellLikeToolName(name: string): boolean {
  return toolNameWords(name).some((word) => shellWords.has(word));
}

/** The tool names that look like a shell. Empty means PERM-6 holds for this registry. */
export function findShellLikeTools(toolNames: Iterable<string>): string[] {
  return [...toolNames].filter(isShellLikeToolName);
}

export function assertNoShellTool(toolNames: Iterable<string>): void {
  const shellLike = findShellLikeTools(toolNames);
  if (shellLike.length > 0) {
    throw new Error(
      `PERM-6 violated: the registry contains shell-like tools: ${shellLike.join(", ")}`,
    );
  }
}
