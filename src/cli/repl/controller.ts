// The REPL's behaviour without the drawing: input, turns, slash commands, Ctrl+C,
// approval prompts, and the picker. The Ink view subscribes to its state.

import type {
  ApprovalAnswer,
  ApprovalRequest,
  SlashCommand,
  SlashCommandContext,
} from "../../contracts/index.ts";
import { extractAttachments } from "../attachments.ts";
import type { Harness } from "../harness.ts";
import { errorMessage, redactSecrets } from "../secrets.ts";
import { isSlashCommand, SlashCommandDispatcher } from "../slash-commands.ts";
import { statusLineFor } from "../status-line.ts";
import { ReplDialogs } from "./dialogs.ts";
import { approvalKey, editLine, isCtrlC } from "./key-handling.ts";
import {
  appendEntries,
  type ChoiceOption,
  type EntryKind,
  type KeyPress,
  type ReplState,
} from "./repl-state.ts";
import { emptyLiveTurn } from "./turn-presenter.ts";
import { type ReplTurnOptions, runReplTurn } from "./turn-runner.ts";

export interface ReplControllerOptions {
  harness: Harness;
  workingDirectory: string;
  /** Reasoning is drawn dimmed when shown; never mixed into the answer. */
  showReasoning?: boolean;
  /** Commands the cli adds beside the harness's own, such as `/config`. */
  cliCommands?: readonly SlashCommand[];
}

const exitHint = "Press Ctrl+C again to exit.";

export class ReplController {
  private readonly harness: Harness;
  private readonly workingDirectory: string;
  private readonly showReasoning: boolean;
  private readonly dispatcher: SlashCommandDispatcher;
  private readonly listeners = new Set<() => void>();
  private state: ReplState;
  private turnAbort: AbortController | undefined;
  private exitArmed = false;
  private resolveApproval: ((answer: ApprovalAnswer) => void) | undefined;
  private readonly dialogs = new ReplDialogs({
    get: () => this.state,
    update: (changes) => this.update(changes),
  });
  private readonly exited: Promise<void>;
  private resolveExited: () => void = () => {};

  constructor(options: ReplControllerOptions) {
    this.harness = options.harness;
    this.workingDirectory = options.workingDirectory;
    this.showReasoning = options.showReasoning ?? true;
    const commands = [...(options.cliCommands ?? []), ...options.harness.slashCommands];
    this.dispatcher = new SlashCommandDispatcher(commands, {
      requestExit: () => this.exit(),
      startNewSession: () => this.harness.startNewSession(),
    });
    this.exited = new Promise((resolve) => {
      this.resolveExited = resolve;
    });
    this.state = {
      entries: appendEntries([], { kind: "info", text: this.welcomeText() }),
      live: undefined,
      activity: undefined,
      input: "",
      statusLine: this.statusLine(),
      notice: undefined,
      approval: undefined,
      choice: undefined,
      question: undefined,
      busy: false,
      exited: false,
    };
  }

  getState = (): ReplState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  whenExited(): Promise<void> {
    return this.exited;
  }

  handleKey(input: string, key: KeyPress): void {
    if (isCtrlC(input, key)) {
      this.interrupt();
      return;
    }
    if (this.exitArmed) {
      this.exitArmed = false;
      this.update({ notice: undefined });
    }
    if (this.state.approval) this.handleApprovalKey(input, key);
    else if (this.dialogs.open) this.dialogs.handleKey(input, key);
    else if (!this.state.busy) this.handleInputKey(input, key);
  }

  /** CLI-5: cancel what is running; a second press with nothing running exits. */
  interrupt(): void {
    if (this.exitArmed) {
      this.exit();
      return;
    }
    this.exitArmed = true;
    this.dialogs.cancel();
    if (this.turnAbort && !this.turnAbort.signal.aborted) {
      this.turnAbort.abort();
      this.answerApproval({ kind: "deny", feedback: "The user cancelled the turn." });
    }
    this.update({ notice: exitHint });
  }

  async submit(line: string): Promise<void> {
    const trimmed = line.trim();
    this.update({ input: "" });
    if (trimmed === "" || this.state.busy) return;
    if (isSlashCommand(trimmed)) await this.runSlashCommand(trimmed);
    else await this.runTurn(trimmed);
  }

  requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswer> {
    if (this.resolveApproval) {
      return Promise.reject(new Error("An approval prompt is already open."));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.resolveApproval = undefined;
        this.update({ approval: undefined });
        reject(signal?.reason);
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.resolveApproval = (answer) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(answer);
      };
      this.update({ approval: { request, stage: "choose", feedback: "" } });
    });
  }

  /** A message from outside a turn, such as an LM Studio warning. */
  showNotice(text: string): void {
    this.appendEntry("info", text);
  }

  choose(prompt: string, options: ChoiceOption[]): Promise<string | undefined> {
    return this.dialogs.choose(prompt, options);
  }

  /** A typed answer on the input line. Ctrl+C or Esc resolves to undefined. */
  ask(prompt: string, options: { secret?: boolean } = {}): Promise<string | undefined> {
    return this.dialogs.ask(prompt, options);
  }

  private async runTurn(line: string): Promise<void> {
    const input = extractAttachments(line, { workingDirectory: this.workingDirectory });
    const attached = (input.attachments ?? []).map((attachment) => attachment.path).join(", ");
    this.appendEntry("user", line);
    if (attached) this.appendEntry("info", `Attached: ${attached}`);

    const abort = new AbortController();
    this.turnAbort = abort;
    this.update({ busy: true, live: emptyLiveTurn });
    try {
      await runReplTurn(this.turnOptions(), input, abort.signal);
    } finally {
      this.turnAbort = undefined;
      this.update({ busy: false, live: undefined, activity: undefined });
    }
  }

  private turnOptions(): ReplTurnOptions {
    return {
      harness: this.harness,
      showReasoning: this.showReasoning,
      store: { get: this.getState, set: (next) => this.setState(next) },
      statusLine: () => this.statusLine(),
    };
  }

  private async runSlashCommand(line: string): Promise<void> {
    this.appendEntry("user", line);
    // Ctrl+C reaches a long command (`/index`) the same way it reaches a turn.
    const abort = new AbortController();
    this.turnAbort = abort;
    this.update({ busy: true });
    try {
      await this.dispatcher.dispatch(line, this.slashCommandContext(abort.signal));
    } catch (error) {
      this.appendEntry("error", errorMessage(error));
    } finally {
      this.turnAbort = undefined;
      this.update({ busy: false, statusLine: this.statusLine() });
    }
  }

  private slashCommandContext(signal: AbortSignal): SlashCommandContext {
    return {
      signal,
      session: this.harness.session(),
      config: this.harness.config,
      lm: this.harness.lm,
      print: (text) => this.appendEntry("info", text),
      choose: (prompt, options) => this.choose(prompt, options),
      ask: (prompt, options) => this.ask(prompt, options),
    };
  }

  private handleInputKey(input: string, key: KeyPress): void {
    if (key.return) {
      void this.submit(this.state.input);
      return;
    }
    const edited = editLine(this.state.input, input, key);
    if (edited !== this.state.input) this.update({ input: edited });
  }

  private handleApprovalKey(input: string, key: KeyPress): void {
    const approval = this.state.approval;
    if (!approval) return;
    const result = approvalKey(approval, input, key);
    if (result.kind === "answer") this.answerApproval(result.answer);
    else if (result.kind === "update") this.update({ approval: result.approval });
  }

  private answerApproval(answer: ApprovalAnswer): void {
    const resolve = this.resolveApproval;
    this.resolveApproval = undefined;
    this.update({ approval: undefined });
    resolve?.(answer);
  }

  private exit(): void {
    this.turnAbort?.abort();
    this.dialogs.cancel();
    this.update({ exited: true });
    this.resolveExited();
  }

  private appendEntry(kind: EntryKind, text: string): void {
    const safeText = redactSecrets(text, this.harness.config);
    this.update({ entries: appendEntries(this.state.entries, { kind, text: safeText }) });
  }

  private statusLine(): string {
    return statusLineFor(this.harness);
  }

  private welcomeText(): string {
    const resumed = this.harness.resumed ? " Resumed the most recent session." : "";
    return `clankr: type a prompt, /help for commands, Ctrl+C twice to exit.${resumed}`;
  }

  private update(changes: Partial<ReplState>): void {
    this.setState({ ...this.state, ...changes });
  }

  private setState(next: ReplState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
