// The hard summary cap. The model is asked to stay within it; this makes sure it does.

export type TokenCounter = (text: string) => Promise<number>;

export interface CappedSummary {
  text: string;
  tokens: number;
  truncated: boolean;
}

const cutMarker = " …[summary cut to fit]";

/** Shrinks a little more than the proportion suggests, so one recount usually suffices. */
const shrinkMargin = 0.9;

/**
 * Cuts `text` at a word boundary until the counter says it fits `tokenCap`. The cut length
 * shrinks every pass, so the loop always ends, at worst with an empty summary.
 */
export async function capSummary(
  text: string,
  tokenCap: number,
  countTokens: TokenCounter,
): Promise<CappedSummary> {
  let tokens = await countTokens(text);
  if (tokens <= tokenCap) return { text, tokens, truncated: false };

  let length = text.length;
  while (length > 0) {
    length = Math.floor(length * Math.min(shrinkMargin, (tokenCap / tokens) * shrinkMargin));
    const candidate = `${cutAtWordBoundary(text, length)}${cutMarker}`;
    tokens = await countTokens(candidate);
    if (tokens <= tokenCap) return { text: candidate, tokens, truncated: true };
  }
  return { text: "", tokens: 0, truncated: true };
}

function cutAtWordBoundary(text: string, length: number): string {
  const slice = text.slice(0, length);
  const lastSpace = slice.lastIndexOf(" ");
  // Cutting mid-word is better than dropping most of a short slice.
  const cut = lastSpace > length / 2 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd();
}
