// Native tool calls stream in as deltas keyed by index (the LM Studio client passes them
// through uninterpreted). This joins them into whole calls.

import type { ChatEvent, ToolCall } from "../contracts/index.ts";

type ToolCallDelta = Extract<ChatEvent, { type: "tool-call-delta" }>;

interface PartialCall {
  id?: string;
  name: string;
  argumentsJson: string;
}

export class ToolCallAssembler {
  private readonly partials = new Map<number, PartialCall>();

  add(delta: ToolCallDelta): void {
    const partial = this.partials.get(delta.index) ?? { name: "", argumentsJson: "" };
    if (delta.id) partial.id = delta.id;
    // Names normally arrive whole in the first delta, but appending is harmless when they do.
    if (delta.name) partial.name += delta.name;
    if (delta.argumentsDelta) partial.argumentsJson += delta.argumentsDelta;
    this.partials.set(delta.index, partial);
  }

  /** Whole calls in index order. A missing id is filled from `fallbackIdPrefix`. */
  finish(fallbackIdPrefix: string): ToolCall[] {
    const indexes = [...this.partials.keys()].sort((first, second) => first - second);
    return indexes.map((index) => {
      const partial = this.partials.get(index) as PartialCall;
      return {
        id: partial.id ?? `${fallbackIdPrefix}_${index + 1}`,
        name: partial.name.trim(),
        argumentsJson: partial.argumentsJson,
      };
    });
  }
}
