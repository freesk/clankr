import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTheme } from "./default-theme.ts";
import { loadTheme } from "./theme-loader.ts";

describe("loadTheme", () => {
  let folder: string;
  let themeFile: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "vix-theme-"));
    themeFile = join(folder, "theme.json");
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("uses the default theme, with no problem, when the file is missing", async () => {
    expect(await loadTheme(themeFile)).toEqual({ theme: defaultTheme });
  });

  it("uses a macOS system font by default", () => {
    expect(defaultTheme.fontFamily).toBe("Helvetica Neue");
  });

  it("reports a malformed file and falls back to the default", async () => {
    await writeFile(themeFile, "{ palette: [");
    const loaded = await loadTheme(themeFile);
    expect(loaded.theme).toEqual(defaultTheme);
    expect(loaded.problem).toMatch(/theme\.json was not used: not valid JSON/);
  });

  it("reports a file that breaks the schema, naming the field", async () => {
    await writeFile(themeFile, JSON.stringify({ palette: ["red"], page: { size: "A3" } }));
    const loaded = await loadTheme(themeFile);
    expect(loaded.theme).toEqual(defaultTheme);
    expect(loaded.problem).toContain("palette.0");
    expect(loaded.problem).toContain("page.size");
  });

  it("merges a partial file over the default and resolves the logo next to it", async () => {
    await writeFile(
      themeFile,
      JSON.stringify({
        palette: ["#112233"],
        page: { size: "Letter" },
        logoPath: "logo.png",
        footer: "Acme",
      }),
    );
    const { theme, problem } = await loadTheme(themeFile);
    expect(problem).toBeUndefined();
    expect(theme).toEqual({
      palette: ["#112233"],
      fontFamily: defaultTheme.fontFamily,
      page: { size: "Letter", orientation: defaultTheme.page.orientation },
      logoPath: join(folder, "logo.png"),
      footer: "Acme",
    });
  });
});
