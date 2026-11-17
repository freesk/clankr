// Reads the theme's logo on the host and hands it to the page as a data URL, so the page
// never fetches it (DATA-14). A missing or unsupported logo is left out with a note.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Theme } from "../../contracts/index.ts";
import type { PageDecorations } from "./page-layout.ts";

export interface LoadedDecorations extends PageDecorations {
  notes: string[];
}

const logoMimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export async function loadDecorations(theme: Theme): Promise<LoadedDecorations> {
  const decorations: LoadedDecorations = { footer: theme.footer, notes: [] };
  if (!theme.logoPath) return decorations;
  const mimeType = logoMimeTypes[extname(theme.logoPath).toLowerCase()];
  if (!mimeType) {
    decorations.notes.push(`Logo ${theme.logoPath} is not a PNG, JPEG, or SVG file; left out.`);
    return decorations;
  }
  try {
    const bytes = await readFile(theme.logoPath);
    decorations.logoDataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    decorations.notes.push(`Logo ${theme.logoPath} could not be read; left out.`);
  }
  return decorations;
}
