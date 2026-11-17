// The REPL's two dialogs that answer with a string: the picker (`/model`) and a typed
// question (`/config`). At most one is open; opening another cancels the first.

import { choiceKey, questionKey } from "./key-handling.ts";
import type { ChoiceOption, KeyPress, ReplState } from "./repl-state.ts";

export interface DialogStateStore {
  get(): ReplState;
  update(changes: Partial<ReplState>): void;
}

export class ReplDialogs {
  private readonly store: DialogStateStore;
  /** Answers the open picker or question; undefined means it was cancelled. */
  private resolveDialog: ((value: string | undefined) => void) | undefined;

  constructor(store: DialogStateStore) {
    this.store = store;
  }

  /** True when a key should go to a dialog instead of the input line. */
  get open(): boolean {
    const state = this.store.get();
    return state.choice !== undefined || state.question !== undefined;
  }

  choose(prompt: string, options: ChoiceOption[]): Promise<string | undefined> {
    this.cancel();
    return new Promise((resolve) => {
      this.resolveDialog = resolve;
      this.store.update({ choice: { prompt, options, filter: "", highlighted: 0 } });
    });
  }

  /** A typed answer on the input line. Ctrl+C or Esc resolves to undefined. */
  ask(prompt: string, options: { secret?: boolean } = {}): Promise<string | undefined> {
    this.cancel();
    return new Promise((resolve) => {
      this.resolveDialog = resolve;
      this.store.update({ question: { prompt, secret: options.secret === true, answer: "" } });
    });
  }

  handleKey(input: string, key: KeyPress): void {
    const { choice, question } = this.store.get();
    if (choice) {
      const result = choiceKey(choice, input, key);
      if (result.kind === "select") this.finish(result.value);
      else if (result.kind === "cancel") this.finish(undefined);
      else if (result.kind === "update") this.store.update({ choice: result.choice });
    } else if (question) {
      const result = questionKey(question, input, key);
      if (result.kind === "submit") this.finish(result.answer);
      else if (result.kind === "cancel") this.finish(undefined);
      else if (result.kind === "update") this.store.update({ question: result.question });
    }
  }

  cancel(): void {
    if (this.resolveDialog) this.finish(undefined);
  }

  private finish(value: string | undefined): void {
    const resolve = this.resolveDialog;
    this.resolveDialog = undefined;
    this.store.update({ choice: undefined, question: undefined });
    resolve?.(value);
  }
}
