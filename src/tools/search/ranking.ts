// Ranking for search hits (SRCH-6): one function that combines match quality,
// recency, and path depth. Each factor is scaled to 0..1 before weighting, so the
// weights below read directly as "how much this factor matters".
//
//   score = 0.5 * matchQuality + 0.3 * recency + 0.2 * shallowness
//
// - matchQuality: supplied by the tool (how well the name or content matched).
// - recency: 1 for a file modified now, 0.5 after 30 days, 0.25 after 90 days.
// - shallowness: 1 directly under the root, 0.5 one folder down, 0.33 two down.
//
// Match quality leads because a precise match deep in an old folder is still what
// the user asked for; recency breaks ties among similar matches, and depth prefers
// a user's own files over copies buried inside project or app folders.

const matchWeight = 0.5;
const recencyWeight = 0.3;
const depthWeight = 0.2;
const recencyHalfLifeDays = 30;
const millisecondsPerDay = 86_400_000;

export interface RankInput {
  /** 0..1, from the tool. */
  matchQuality: number;
  modifiedTimeMs: number;
  /** Folders between the root and the hit: 0 for a direct child. */
  depth: number;
}

export function rankScore(input: RankInput, nowMs = Date.now()): number {
  const ageDays = Math.max(0, nowMs - input.modifiedTimeMs) / millisecondsPerDay;
  const recency = 1 / (1 + ageDays / recencyHalfLifeDays);
  const shallowness = 1 / (1 + input.depth);
  const match = Math.min(1, Math.max(0, input.matchQuality));
  return matchWeight * match + recencyWeight * recency + depthWeight * shallowness;
}

/** Sorts best first. Ties fall back to the path so output is stable between runs. */
export function rankHits<Hit extends RankInput & { path: string }>(
  hits: Hit[],
  nowMs = Date.now(),
): Hit[] {
  const scored = hits.map((hit) => ({ hit, score: rankScore(hit, nowMs) }));
  scored.sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path));
  return scored.map((entry) => entry.hit);
}

/**
 * How well a file name matches what the model asked for. An exact name beats a
 * name that starts with the text, which beats one that merely contains it.
 */
export function nameMatchQuality(name: string, pattern: string | undefined): number {
  if (!pattern) return 0.5;
  const lowerName = name.toLowerCase();
  const literal = pattern.replace(/[*?[\]{}]/g, "").toLowerCase();
  if (literal === "") return 0.5;
  const stem = lowerName.replace(/\.[^.]+$/, "");
  if (lowerName === literal || stem === literal) return 1;
  if (lowerName.startsWith(literal)) return 0.8;
  if (lowerName.includes(literal)) return 0.6;
  return 0.4;
}

/** Content matches: more matching lines in a file means a stronger hit, up to ten. */
export function contentMatchQuality(matchCount: number): number {
  return Math.min(1, 0.3 + matchCount * 0.07);
}
