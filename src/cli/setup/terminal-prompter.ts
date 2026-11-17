// The setup prompter for `clankr config` and the first-run offer: plain Node readline, so the
// setup never loads Ink (CLAUDE.md rule 7).

import { createInterface, type Interface } from "node:readline";
import { Writable } from "node:stream";
import type { SetupPrompter } from "./prompter.ts";

export interface TerminalPrompterOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** True for a real terminal: line editing, echo, and Ctrl+C as a key. */
  terminal: boolean;
}

export class TerminalPrompter implements SetupPrompter {
  private readonly readline: Interface;
  private readonly output: NodeJS.WritableStream;
  private readonly terminal: boolean;
  /**
   * While true, readline's echo of typed keys is dropped. That is the case during a secret
   * question and between questions, because text typed or pasted ahead may be the token.
   */
  private muted = true;
  /** Lines that arrived before they were asked for, as happens with piped input. */
  private readonly pendingLines: string[] = [];
  private waiting: ((line: string | undefined) => void) | undefined;
  private ended = false;

  constructor(options: TerminalPrompterOptions) {
    this.output = options.output;
    this.terminal = options.terminal;
    const echo = new Writable({
      write: (chunk, _encoding, callback) => {
        if (!this.muted) options.output.write(chunk);
        callback();
      },
    });
    this.readline = createInterface({
      input: options.input,
      output: echo,
      terminal: options.terminal,
      // Kept out of history so the token cannot be recalled with the up arrow.
      historySize: 0,
    });
    this.readline.on("line", (line) => this.receive(line));
    this.readline.on("close", () => this.end());
    this.readline.on("SIGINT", () => {
      this.pendingLines.length = 0;
      this.readline.close();
    });
  }

  print(text: string): void {
    this.output.write(`${text}\n`);
  }

  async ask(question: string, options: { secret?: boolean } = {}): Promise<string | undefined> {
    if (this.pendingLines.length === 0 && this.ended) return undefined;
    const secret = options.secret === true;
    this.readline.setPrompt(question);
    if (secret) {
      // readline's own prompt would redraw any text typed ahead, so the question goes out
      // directly and the echo stays off.
      this.output.write(question);
      this.readline.resume();
    } else {
      this.muted = false;
      this.readline.prompt();
    }
    try {
      return await this.nextLine();
    } finally {
      this.muted = true;
      // A terminal echoed the answer and its Enter; muted or piped input did not.
      if (options.secret || !this.terminal) this.output.write("\n");
    }
  }

  /** Releases stdin so the process can exit or hand the terminal to something else. */
  close(): void {
    this.readline.close();
  }

  private nextLine(): Promise<string | undefined> {
    const line = this.pendingLines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.ended) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  private receive(line: string): void {
    // Lines after this one in the same chunk are echoed before the next question is asked.
    this.muted = true;
    const waiting = this.waiting;
    this.waiting = undefined;
    if (waiting) waiting(line);
    else this.pendingLines.push(line);
  }

  private end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.(undefined);
  }
}
