// The short summary printed under a chart: render(spec, rows, summary). It is plain text for the
// reader, so it is tidied here and later placed in the page with textContent, never as HTML.

import { ToolError } from "../contracts/index.ts";

/** About three sentences. Longer text would crowd the chart off its page. */
export const maxSummaryCharacters = 400;

export interface ChartSummary {
  summary?: string;
  /** Set when the summary was shortened. */
  note?: string;
}

/** Checks and tidies the third `render` argument. A missing summary is allowed. */
export function normaliseSummary(value: unknown): ChartSummary {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") {
    throw new ToolError(
      'render(spec, rows, summary): summary must be text, such as "Sales rose 12%, led by the north."',
    );
  }
  // Control characters and runs of whitespace would print as boxes or gaps.
  const tidied = Array.from(value, (character) => (isControl(character) ? " " : character))
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (tidied === "") return {};
  if (tidied.length <= maxSummaryCharacters) return { summary: tidied };
  return {
    summary: `${tidied.slice(0, maxSummaryCharacters - 1).trimEnd()}…`,
    note: `A summary was cut to ${maxSummaryCharacters} characters; keep it to 1-3 sentences.`,
  };
}

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}
