// Building what the user sees before a change (FS-7): a unified diff for a text edit,
// the first lines and size of a new file, one line for everything else.

/** How many lines of a new file the preview shows. */
const newFilePreviewLines = 20;

/** A unified diff with three lines of context. Both texts use "\n" line endings. */
export async function unifiedDiff(name: string, before: string, after: string): Promise<string> {
  // Loaded lazily: previews happen long after startup.
  const { createTwoFilesPatch, FILE_HEADERS_ONLY } = await import("diff");
  return createTwoFilesPatch(name, name, before, after, undefined, undefined, {
    context: 3,
    headerOptions: FILE_HEADERS_ONLY,
  });
}

/** A new file as an all-added diff hunk, cut to its first lines. */
export function newFileListing(name: string, text: string): string {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const shown = text === "" ? [] : lines.slice(0, newFilePreviewLines);
  const listing = [`--- /dev/null`, `+++ ${name}`, `@@ -0,0 +1,${shown.length} @@`];
  for (const line of shown) listing.push(`+${line}`);
  const hidden = text === "" ? 0 : lines.length - shown.length;
  if (hidden > 0) listing.push(`... ${hidden} more line${hidden === 1 ? "" : "s"}`);
  return `${listing.join("\n")}\n`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function countLines(text: string): number {
  if (text === "") return 0;
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
