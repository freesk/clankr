// Tool calls written as text, for models not trained for tool use (MOD-6). The model writes
//   <tool_call>{"name": "read_file", "arguments": {"path": "notes.md"}}</tool_call>
// and the loop parses the blocks out of the reply. The same parser also rescues a natively
// prompted model that wrote a call as text instead of using the tools field.

import type { ToolCall } from "../contracts/index.ts";
import { isPlainObject, parseArgumentsLeniently } from "./lenient-json.ts";

export const toolCallOpenTag = "<tool_call>";
export const toolCallCloseTag = "</tool_call>";

export interface ExtractedToolCalls {
  /** The reply with every tool-call block removed. */
  text: string;
  calls: ToolCall[];
}

export function extractToolCallsFromText(reply: string, idPrefix: string): ExtractedToolCalls {
  const calls: ToolCall[] = [];
  let text = "";
  let rest = reply;
  while (true) {
    const open = rest.indexOf(toolCallOpenTag);
    if (open < 0) break;
    text += rest.slice(0, open);
    const afterOpen = rest.slice(open + toolCallOpenTag.length);
    const close = afterOpen.indexOf(toolCallCloseTag);
    // A missing close tag usually means the model stopped early; take what is there.
    const block = close < 0 ? afterOpen : afterOpen.slice(0, close);
    calls.push(parseBlock(block, `${idPrefix}_${calls.length + 1}`));
    rest = close < 0 ? "" : afterOpen.slice(close + toolCallCloseTag.length);
  }
  text += rest;
  return { text: text.trim(), calls };
}

function parseBlock(block: string, id: string): ToolCall {
  const parsed = parseArgumentsLeniently(block);
  if (!parsed.ok) {
    // Keep the raw block as the arguments so the corrective error path handles it.
    const name = /"name"\s*:\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    return { id, name, argumentsJson: block };
  }
  const name = typeof parsed.value.name === "string" ? parsed.value.name : "";
  // Some models say "parameters" where the format says "arguments".
  const args = parsed.value.arguments ?? parsed.value.parameters ?? {};
  const argumentsJson = isPlainObject(args) ? JSON.stringify(args) : String(args);
  return { id, name, argumentsJson };
}

/**
 * Streams reply text to the user with tool-call blocks held back, so the user sees prose
 * and a tool line, not raw markup. A partial open tag at the end of a delta is held until
 * the next delta shows whether it is a tag.
 */
export class ToolCallTextFilter {
  private pending = "";
  private insideBlock = false;

  /** Returns the text that is safe to show now. */
  push(delta: string): string {
    this.pending += delta;
    let visible = "";
    while (this.pending !== "") {
      if (this.insideBlock) {
        const close = this.pending.indexOf(toolCallCloseTag);
        if (close < 0) break;
        this.pending = this.pending.slice(close + toolCallCloseTag.length);
        this.insideBlock = false;
        continue;
      }
      const open = this.pending.indexOf(toolCallOpenTag);
      if (open >= 0) {
        visible += this.pending.slice(0, open);
        this.pending = this.pending.slice(open + toolCallOpenTag.length);
        this.insideBlock = true;
        continue;
      }
      const heldBack = partialTagLength(this.pending);
      visible += this.pending.slice(0, this.pending.length - heldBack);
      this.pending = this.pending.slice(this.pending.length - heldBack);
      break;
    }
    return visible;
  }

  /** Call when the reply ends. Text inside an unclosed block is never shown. */
  flush(): string {
    const visible = this.insideBlock ? "" : this.pending;
    this.pending = "";
    return visible;
  }
}

/** Length of the longest suffix of `text` that could be the start of the open tag. */
function partialTagLength(text: string): number {
  const longest = Math.min(text.length, toolCallOpenTag.length - 1);
  for (let length = longest; length > 0; length--) {
    if (toolCallOpenTag.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}
