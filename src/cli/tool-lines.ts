// One compact line per tool call (CLI-4): tool, key argument, result size, duration.
// The key argument comes from the event, so nothing here knows about individual tools.

import type { AgentEvent } from "../contracts/index.ts";

type ToolStartEvent = Extract<AgentEvent, { type: "tool-start" }>;
type ToolEndEvent = Extract<AgentEvent, { type: "tool-end" }>;

export interface ToolLine {
  tool: string;
  keyArgument: string;
  text: string;
  failed: boolean;
}

const maximumKeyArgumentLength = 60;

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function shorten(text: string, maximumLength: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maximumLength) return singleLine;
  return `${singleLine.slice(0, maximumLength - 1)}…`;
}

export function formatToolLine(start: ToolStartEvent, end: ToolEndEvent): ToolLine {
  const keyArgument = shorten(start.keyArgument, maximumKeyArgumentLength);
  const head = keyArgument ? `${start.tool} ${keyArgument}` : start.tool;
  const duration = formatDuration(end.durationMs);
  const identity = { tool: start.tool, keyArgument: start.keyArgument };
  if (end.error) {
    const text = `✗ ${head} · ${shorten(end.error, 80)} · ${duration}`;
    return { ...identity, text, failed: true };
  }
  const size = `${formatTokenCount(end.resultTokens)} tokens`;
  return { ...identity, text: `● ${head} · ${size} · ${duration}`, failed: false };
}

/** Pairs each tool-end with its tool-start by call id. */
export class ToolLineTracker {
  private readonly started = new Map<string, ToolStartEvent>();

  start(event: ToolStartEvent): void {
    this.started.set(event.callId, event);
  }

  /** The line for a finished call. A tool-end without a start still gets a line. */
  end(event: ToolEndEvent): ToolLine {
    const start = this.started.get(event.callId) ?? {
      type: "tool-start",
      callId: event.callId,
      tool: "tool",
      keyArgument: "",
    };
    this.started.delete(event.callId);
    return formatToolLine(start, event);
  }

  /** Name of a call that started and has not ended, for a "running" indicator. */
  runningTool(): string | undefined {
    const last = [...this.started.values()].at(-1);
    if (!last) return undefined;
    return `${last.tool} ${shorten(last.keyArgument, maximumKeyArgumentLength)}`.trimEnd();
  }
}
