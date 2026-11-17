// The built-in theme, used when ~/.vix/theme.json is absent or broken (DATA-15).

import type { Theme } from "../contracts/index.ts";
import { systemFontFamily } from "../engines/browser/index.ts";

/** Tableau 10: distinct hues that stay apart for the common forms of colour blindness. */
const defaultPalette = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

export const defaultTheme: Theme = {
  palette: defaultPalette,
  // A macOS system font, so no font is shipped (D31).
  fontFamily: systemFontFamily,
  page: { size: "A4", orientation: "landscape" },
};
