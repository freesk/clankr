// The live activity line under the transcript while a turn runs: what the turn is doing now,
// what is piling up, and for how long. A small model takes 30 to 120 s per turn, so a bare
// "Working…" looked stuck; this line moves several times a second and names the work.

import type { AgentEvent } from "../../contracts/index.ts";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** How often the line is redrawn; each redraw also advances the spinner one frame. */
export const activityRefreshMilliseconds = 125;

type Phase =
  | { kind: "waiting"; since: number }
  | { kind: "thinking"; since: number }
  | { kind: "writing"; since: number }
  | { kind: "tool"; tool: string; since: number };

interface RunningTool {
  tool: string;
  since: number;
}

/** Counts words in streamed text, which arrives split at arbitrary points. */
class WordCounter {
  private count = 0;
  private insideWord = false;

  push(delta: string): void {
    for (const character of delta) {
      const isSpace = /\s/.test(character);
      if (!isSpace && !this.insideWord) this.count += 1;
      this.insideWord = !isSpace;
    }
  }

  get words(): number {
    return this.count;
  }
}

/** Folds a turn's events into the current phase; `describe` turns it into the line. */
export class TurnActivity {
  private readonly turnStart: number;
  private phase: Phase;
  private reasoning = new WordCounter();
  private answer = new WordCounter();
  /** By call id, in start order, so a sub-agent's call shows over the `delegate` running it. */
  private readonly runningTools = new Map<string, RunningTool>();

  constructor(now: number) {
    this.turnStart = now;
    this.phase = { kind: "waiting", since: now };
  }

  apply(event: AgentEvent, now: number): void {
    switch (event.type) {
      case "model-call-start":
        this.reasoning = new WordCounter();
        this.answer = new WordCounter();
        this.phase = { kind: "waiting", since: now };
        return;
      case "reasoning":
        this.reasoning.push(event.delta);
        if (this.phase.kind !== "thinking") this.phase = { kind: "thinking", since: now };
        return;
      case "text":
        this.answer.push(event.delta);
        if (this.phase.kind !== "writing") this.phase = { kind: "writing", since: now };
        return;
      case "tool-start":
        this.runningTools.set(event.callId, { tool: event.tool, since: now });
        this.phase = { kind: "tool", tool: event.tool, since: now };
        return;
      case "tool-end":
        this.runningTools.delete(event.callId);
        this.phase = this.phaseAfterTool(now);
        return;
      case "turn-end":
        return;
    }
  }

  /** For example `⠙ thinking · 412 words · 18s` or `⠸ query_sql running · 3.1s (turn 41s)`. */
  describe(now: number): string {
    const turnElapsed = now - this.turnStart;
    const phaseElapsed = now - this.phase.since;
    const spinner = spinnerFrameAt(turnElapsed);
    switch (this.phase.kind) {
      case "waiting":
        return `${spinner} waiting for the model · ${this.timing(phaseElapsed, turnElapsed, false)}`;
      case "thinking":
        return `${spinner} thinking · ${wordCount(this.reasoning.words)} · ${formatElapsed(turnElapsed)}`;
      case "writing":
        return `${spinner} writing answer · ${wordCount(this.answer.words)} · ${formatElapsed(turnElapsed)}`;
      case "tool":
        return `${spinner} ${this.phase.tool} running · ${this.timing(phaseElapsed, turnElapsed, true)}`;
    }
  }

  /** The newest call still running, such as `delegate` once its sub-agent's call ends. */
  private phaseAfterTool(now: number): Phase {
    const newest = [...this.runningTools.values()].at(-1);
    if (newest) return { kind: "tool", tool: newest.tool, since: newest.since };
    // Next comes another call or the next request, which is prepared before it is sent.
    return { kind: "waiting", since: now };
  }

  /** The phase's own time, plus the turn's when the phase did not start the turn. */
  private timing(phaseElapsed: number, turnElapsed: number, precise: boolean): string {
    const phase = formatElapsed(phaseElapsed, precise);
    if (turnElapsed - phaseElapsed < 1000) return phase;
    return `${phase} (turn ${formatElapsed(turnElapsed)})`;
  }
}

function spinnerFrameAt(elapsedMilliseconds: number): string {
  const frame = Math.floor(elapsedMilliseconds / activityRefreshMilliseconds);
  return spinnerFrames[frame % spinnerFrames.length] ?? "";
}

function wordCount(words: number): string {
  return words === 1 ? "1 word" : `${words.toLocaleString("en-US")} words`;
}

/** `18s`, `3.1s` when precise, `2m 05s` past a minute. */
export function formatElapsed(milliseconds: number, precise = false): string {
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 60) return precise ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${minutes}m ${remainder}s`;
}
