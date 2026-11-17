// The words `clankr index` and `/index` print: the list of indexed folders, and the summary
// of an indexing run.

import type { Config } from "../contracts/index.ts";
import { countLabel, displayRoot } from "../tools/search/format.ts";
import type { BuildSummary } from "./build-index.ts";
import { formatAge } from "./format-passages.ts";
import type { IndexCatalog, IndexedFolder } from "./index-catalog.ts";

export const nothingIndexedText =
  "No folder is indexed. Index one with `clankr index <folder>` (inside clankr: `/index <folder>`).";

/**
 * Indexed folders (embedding model: text-embedding-nomic-embed-text-v1.5)
 * ~/Documents/contracts · 1,204 files · 18,420 passages · indexed 2 days ago
 */
export function statusText(catalog: IndexCatalog, config: Config, now: Date = new Date()): string {
  if (catalog.folders.length === 0 && catalog.unreadable.length === 0) return nothingIndexedText;
  const model = config.search.embeddingModel;
  const lines = [`Indexed folders (embedding model: ${model})`];
  for (const folder of catalog.folders) lines.push(folderLine(folder, model, now));
  for (const index of catalog.unreadable) {
    lines.push(`Could not read ${index.indexFile}: ${index.problem}`);
  }
  return lines.join("\n");
}

function folderLine(folder: IndexedFolder, configuredModel: string, now: Date): string {
  const root = displayRoot(folder.root);
  const parts = [
    root,
    countLabel(folder.fileCount, "file"),
    countLabel(folder.passageCount, "passage"),
    folder.updatedAt ? `indexed ${formatAge(folder.updatedAt, now)}` : "never finished",
  ];
  if (folder.embeddingModel !== configuredModel) {
    parts.push(
      `built with "${folder.embeddingModel}": rebuild with \`clankr index --rebuild ${root}\``,
    );
  } else if (!folder.complete) {
    parts.push(`unfinished: run \`clankr index ${root}\` again`);
  }
  return parts.join(" · ");
}

/**
 * Indexed ~/notes in 42 s: 120 files read (1,930 passages), 1,084 unchanged, 3 removed.
 * Skipped: 4 too large, 2 no text layer (a scanned PDF?).
 * The index now holds 1,204 files and 18,420 passages.
 */
export function summaryText(summary: BuildSummary): string {
  const root = displayRoot(summary.root);
  const duration = durationLabel(summary.elapsedMs);
  const work = [
    `${countLabel(summary.indexed, "file")} read (${countLabel(summary.passagesWritten, "passage")})`,
    `${summary.unchanged.toLocaleString("en-US")} unchanged`,
    `${summary.removed.toLocaleString("en-US")} removed`,
  ].join(", ");
  const lines = [
    summary.cancelled
      ? `Indexing of ${root} cancelled after ${duration}: ${work}. What was stored is kept; run it again to continue.`
      : `Indexed ${root} in ${duration}: ${work}.`,
  ];
  if (summary.skipped.length > 0) {
    const reasons = summary.skipped.map(([reason, count]) => `${count} ${reason}`).join(", ");
    lines.push(`Skipped: ${reasons}.`);
  }
  lines.push(
    `The index now holds ${countLabel(summary.totalFiles, "file")} and ${countLabel(summary.totalPassages, "passage")}.`,
  );
  return lines.join("\n");
}

/** "less than 1 s", "42 s", "12 min". */
function durationLabel(elapsedMs: number): string {
  if (elapsedMs < 1_000) return "less than 1 s";
  const seconds = Math.round(elapsedMs / 1_000);
  return seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
