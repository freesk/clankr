// Loads ~/.clankr/theme.json (DATA-15). Every field is optional and falls back to the default
// theme. A broken file never fails a chart: the problem is reported and the default is used.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { Theme } from "../contracts/index.ts";
import { defaultTheme } from "./default-theme.ts";

const hexColour = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "a colour like #4e79a7");

const themeFileSchema = z
  .object({
    palette: z.array(hexColour).min(1).optional(),
    fontFamily: z.string().min(1).optional(),
    page: z
      .object({
        size: z.enum(["A4", "Letter"]).optional(),
        orientation: z.enum(["portrait", "landscape"]).optional(),
      })
      .strict()
      .optional(),
    logoPath: z.string().min(1).optional(),
    footer: z.string().max(200).optional(),
  })
  .strict();

export interface LoadedTheme {
  theme: Theme;
  /** Set when the file exists but could not be used. Show it to the user. */
  problem?: string;
}

export async function loadTheme(themeFile: string): Promise<LoadedTheme> {
  let text: string;
  try {
    text = await readFile(themeFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { theme: defaultTheme };
    return withProblem(themeFile, (error as Error).message);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return withProblem(themeFile, `not valid JSON (${(error as Error).message})`);
  }
  const parsed = themeFileSchema.safeParse(json);
  if (!parsed.success) return withProblem(themeFile, describeIssues(parsed.error));
  return { theme: mergeWithDefault(parsed.data, dirname(themeFile)) };
}

function mergeWithDefault(file: z.infer<typeof themeFileSchema>, themeFolder: string): Theme {
  const theme: Theme = {
    palette: file.palette ?? defaultTheme.palette,
    fontFamily: file.fontFamily ?? defaultTheme.fontFamily,
    page: {
      size: file.page?.size ?? defaultTheme.page.size,
      orientation: file.page?.orientation ?? defaultTheme.page.orientation,
    },
  };
  if (file.logoPath) theme.logoPath = resolveLogoPath(file.logoPath, themeFolder);
  if (file.footer) theme.footer = file.footer;
  return theme;
}

/** `~` is the home folder; a relative path is relative to the theme file. */
function resolveLogoPath(logoPath: string, themeFolder: string): string {
  if (logoPath === "~" || logoPath.startsWith("~/")) return join(homedir(), logoPath.slice(1));
  return isAbsolute(logoPath) ? logoPath : resolve(themeFolder, logoPath);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message}`)
    .join("; ");
}

function withProblem(themeFile: string, detail: string): LoadedTheme {
  return {
    theme: defaultTheme,
    problem: `Theme file ${themeFile} was not used: ${detail}. Using the default theme.`,
  };
}
