// The REPL's behaviour without the drawing: input, turns, slash commands, Ctrl+C,
// approval prompts, and the picker. The Ink view subscribes to its state.

import type {
  ApprovalAnswer,
  ApprovalRequest,
  SlashCommand,
  SlashCommandContext,
} from "../../contracts/index.ts";
import { untilAborted } from "../abortable.ts";
import { extractAttachments } from "../attachments.ts";
import type { Harness } from "../harness.ts";
import { errorMessage, redactSecrets } from "../secrets.ts";
import { isSlashCommand, SlashCommandDispatcher } from "../slash-commands.ts";
import { formatStatusLine } from "../status-line.ts";
import { approvalKey, choiceKey, editLine, isCtrlC, questionKey } from "./key-handling.ts";
import {
  appendEntries,
  type ChoiceOption,
  type EntryKind,
  type KeyPress,
  type ReplState,
} from "./repl-state.ts";
import { emptyLiveTurn, TurnPresenter } from "./turn-presenter.ts";

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
  /** Answers the open picker or question; undefined means it was cancelled. */
  private resolveDialog: ((value: string | undefined) => void) | undefined;
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
    else if (this.state.choice) this.handleChoiceKey(input, key);
    else if (this.state.question) this.handleQuestionKey(input, key);
    else if (!this.state.busy) this.handleInputKey(input, key);
  }

  /** CLI-5: cancel what is running; a second press with nothing running exits. */
  interrupt(): void {
    if (this.exitArmed) {
      this.exit();
      return;
    }
    this.exitArmed = true;
    this.cancelDialog();
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
    this.cancelDialog();
    return new Promise((resolve) => {
      this.resolveDialog = resolve;
      this.update({ choice: { prompt, options, filter: "", highlighted: 0 } });
    });
  }

  /** A typed answer on the input line. Ctrl+C or Esc resolves to undefined. */
  ask(prompt: string, options: { secret?: boolean } = {}): Promise<string | undefined> {
    this.cancelDialog();
    return new Promise((resolve) => {
      this.resolveDialog = resolve;
      this.update({ question: { prompt, secret: options.secret === true, answer: "" } });
    });
  }

  private async runTurn(line: string): Promise<void> {
    const input = extractAttachments(line, { workingDirectory: this.workingDirectory });
    const attached = (input.attachments ?? []).map((attachment) => attachment.path).join(", ");
    this.appendEntry("user", line);
    if (attached) this.appendEntry("info", `Attached: ${attached}`);

    const abort = new AbortController();
    this.turnAbort = abort;
    this.update({ busy: true, live: emptyLiveTurn });
    const presenter = new TurnPresenter(this.harness.config, this.showReasoning);
    try {
      const events = this.harness.runTurn(input, abort.signal);
      for await (const event of untilAborted(events, abort.signal)) {
        this.setState(presenter.apply(this.state, event));
      }
      if (!presenter.finished) {
        const reason = abort.signal.aborted ? "cancelled" : "error";
        this.setState(presenter.endTurn(this.state, reason));
      }
    } catch (error) {
      const reason = abort.signal.aborted ? "cancelled" : "error";
      this.setState(presenter.endTurn(this.state, reason, errorMessage(error)));
    } finally {
      this.turnAbort = undefined;
      this.update({ busy: false, live: undefined, statusLine: this.statusLine() });
    }
  }

  private async runSlashCommand(line: string): Promise<void> {
    this.appendEntry("user", line);
    this.update({ busy: true });
    try {
      await this.dispatcher.dispatch(line, this.slashCommandContext());
    } catch (error) {
      this.appendEntry("error", errorMessage(error));
    } finally {
      this.update({ busy: false, statusLine: this.statusLine() });
    }
  }

  private slashCommandContext(): SlashCommandContext {
    return {
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

  private handleChoiceKey(input: string, key: KeyPress): void {
    const choice = this.state.choice;
    if (!choice) return;
    const result = choiceKey(choice, input, key);
    if (result.kind === "select") this.finishDialog(result.value);
    else if (result.kind === "cancel") this.finishDialog(undefined);
    else if (result.kind === "update") this.update({ choice: result.choice });
  }

  private handleQuestionKey(input: string, key: KeyPress): void {
    const question = this.state.question;
    if (!question) return;
    const result = questionKey(question, input, key);
    if (result.kind === "submit") this.finishDialog(result.answer);
    else if (result.kind === "cancel") this.finishDialog(undefined);
    else if (result.kind === "update") this.update({ question: result.question });
  }

  private answerApproval(answer: ApprovalAnswer): void {
    const resolve = this.resolveApproval;
    this.resolveApproval = undefined;
    this.update({ approval: undefined });
    resolve?.(answer);
  }

  private cancelDialog(): void {
    if (this.resolveDialog) this.finishDialog(undefined);
  }

  private finishDialog(value: string | undefined): void {
    const resolve = this.resolveDialog;
    this.resolveDialog = undefined;
    this.update({ choice: undefined, question: undefined });
    resolve?.(value);
  }

  private exit(): void {
    this.turnAbort?.abort();
    this.cancelDialog();
    this.update({ exited: true });
    this.resolveExited();
  }

  private appendEntry(kind: EntryKind, text: string): void {
    const safeText = redactSecrets(text, this.harness.config);
    this.update({ entries: appendEntries(this.state.entries, { kind, text: safeText }) });
  }

  private statusLine(): string {
    const session = this.harness.session();
    return formatStatusLine({
      modelKey: session.model?.key ?? this.harness.config.model.default,
      usage: this.harness.usage(),
      permissionMode: session.permissionMode,
      ephemeral: session.ephemeral,
    });
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
