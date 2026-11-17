// Everything the cli takes from the process, so tests can run it without one.

import type { CliComposition } from "./harness.ts";

export interface TextSink {
  write(text: string): unknown;
}

/** "piped" is a pipe or a redirected file; "other" is anything else that is not a terminal. */
export type StdinMode = "terminal" | "piped" | "other";

export interface CliEnvironment {
  argv: string[];
  stdin: NodeJS.ReadStream;
  stdinMode: StdinMode;
  stdout: NodeJS.WriteStream;
  stderr: TextSink;
  environment: Record<string, string | undefined>;
  workingDirectory: string;
  version: string;
  composition: CliComposition;
  /** Calls the handler on SIGINT. Returns a function that removes it. */
  onInterrupt(handler: () => void): () => void;
  /** Exits at once, for a second Ctrl+C while a one-shot turn is still unwinding. */
  forceExit(code: number): void;
}
