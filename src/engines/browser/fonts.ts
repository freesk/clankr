// Fonts are local (SEC-3, D31): no font is shipped. The default theme uses a macOS system
// font, and a theme font that is not installed falls back to it with a note in the result.

import type { Page } from "playwright-core";
import { isFontInstalled } from "./page-calls.ts";

/** Ships with every macOS release vix supports, and embeds cleanly in a PDF. */
export const systemFontFamily = "Helvetica Neue";

export interface ResolvedFont {
  fontFamily: string;
  /** Set when the requested font was replaced. */
  note?: string;
}

export async function resolveFontFamily(page: Page, requested: string): Promise<ResolvedFont> {
  if (requested === systemFontFamily || (await isFontInstalled(page, requested))) {
    return { fontFamily: requested };
  }
  return {
    fontFamily: systemFontFamily,
    note: `Font "${requested}" is not installed; used ${systemFontFamily} instead.`,
  };
}

/** Swaps every use of `from` in the spec's `config` block, which is where the theme put it. */
export function replaceConfigFont(
  spec: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  if (from === to || !isPlainObject(spec.config)) return spec;
  return { ...spec, config: replaceStringDeep(spec.config, from, to) };
}

function replaceStringDeep(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((item) => replaceStringDeep(item, from, to));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceStringDeep(item, from, to)]),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
