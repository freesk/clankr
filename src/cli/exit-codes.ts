// Process exit statuses for `vix` (specs/cli.md, "One-shot exit status").

export const exitCodes = {
  /** The turn finished. */
  done: 0,
  /** The turn failed, hit a limit, or a change was denied. */
  failed: 1,
  /** Bad flags or arguments, or an invalid config file. */
  usage: 2,
  /** Cancelled with Ctrl+C. 128 + SIGINT, as shells report it. */
  cancelled: 130,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];
