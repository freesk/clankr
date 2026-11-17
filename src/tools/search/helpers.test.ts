// Unit tests for the shared pieces: globs, excludes, criteria parsing, the Spotlight
// query, ranking, and formatting.

import { describe, expect, it } from "vitest";
import { ExcludeRules } from "./excludes.ts";
import { parseCriteria, parseDate, parseSize } from "./file-criteria.ts";
import { formatSize, truncateLine } from "./format.ts";
import { expandBraces, globToRegExp, nameMatcher } from "./glob.ts";
import { nameMatchQuality, rankScore } from "./ranking.ts";
import { buildSpotlightQuery } from "./spotlight-query.ts";

describe("globs", () => {
  it("matches names case-insensitively with *, ?, classes, and braces", () => {
    expect(globToRegExp("*.PDF").test("report.pdf")).toBe(true);
    expect(globToRegExp("q?-report.*").test("q3-report.pdf")).toBe(true);
    expect(globToRegExp("[ab]*.txt").test("b1.txt")).toBe(true);
    expect(globToRegExp("*.{jpg,png}").test("cat.png")).toBe(true);
    expect(globToRegExp("*.{jpg,png}").test("cat.gif")).toBe(false);
  });

  it("treats plain text as 'name contains'", () => {
    expect(nameMatcher("Invoice")("2025-invoice-march.pdf")).toBe(true);
  });

  it("expands braces into variants", () => {
    expect(expandBraces("a.{x,y}")).toEqual(["a.x", "a.y"]);
  });
});

describe("excludes", () => {
  it("matches names anywhere, segment sequences, and anchored system folders", () => {
    const rules = new ExcludeRules("/", { useDefaults: true, extra: [] });
    expect(rules.isExcluded("Users/me/project/node_modules/x/index.js")).toBe(true);
    expect(rules.isExcluded("Users/me/Library/Caches/com.app/file")).toBe(true);
    expect(rules.isExcluded("System/Library/x")).toBe(true);
    expect(rules.isExcluded("Users/me/Documents/System/notes.md")).toBe(false);
  });

  it("does not exclude a root the model chose inside an excluded folder", () => {
    const rules = new ExcludeRules("/System/Applications", { useDefaults: true, extra: [] });
    expect(rules.isExcluded("Calculator.app")).toBe(false);
  });

  it("produces the same rules as ripgrep globs", () => {
    const rules = new ExcludeRules("/", {
      useDefaults: false,
      extra: ["build", "Library/Caches", "/opt"],
    });
    expect(rules.ripgrepGlobs()).toEqual(["!build", "!**/Library/Caches", "!/opt"]);
  });
});

describe("criteria parsing", () => {
  it("reads sizes in several forms", () => {
    expect(parseSize("10MB", "min_size")).toBe(10 * 1024 * 1024);
    expect(parseSize("1.5 kb", "min_size")).toBe(1536);
    expect(parseSize(2048, "min_size")).toBe(2048);
    expect(() => parseSize("big", "min_size")).toThrow(/10MB/);
  });

  it("reads absolute and relative dates", () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    expect(parseDate("2025-01-31", "d", now)).toBe(new Date(2025, 0, 31).getTime());
    expect(parseDate("7d", "d", now)).toBe(now - 7 * 86_400_000);
    expect(parseDate("2 weeks ago", "d", now)).toBe(now - 14 * 86_400_000);
    expect(parseDate("today", "d", now)).toBe(new Date(2026, 10, 17).getTime());
  });
});

describe("Spotlight query", () => {
  it("narrows by name, kind, size, and dates in one query", () => {
    const criteria = parseCriteria({
      pattern: "it's*.pdf",
      type: "image",
      max_size: "1KB",
      created_before: "2025-01-01T00:00:00Z",
    });
    expect(buildSpotlightQuery(criteria)).toBe(
      "kMDItemFSName == 'it\\'s*.pdf'cd && (" +
        ["jpg", "jpeg", "png", "gif", "heic", "heif", "webp", "tif", "tiff", "bmp", "svg", "dng"]
          .map((extension) => `kMDItemFSName == '*.${extension}'c`)
          .join(" || ") +
        ") && kMDItemFSSize <= 1024 && kMDItemFSCreationDate < $time.iso(2025-01-01T00:00:00.000Z)",
    );
  });

  it("uses wildcards where Spotlight has no equivalent, and matches everything with no filter", () => {
    expect(buildSpotlightQuery(parseCriteria({ pattern: "q[0-9]-*.{csv,xlsx}" }))).toBe(
      "(kMDItemFSName == 'q*-*.csv'cd || kMDItemFSName == 'q*-*.xlsx'cd)",
    );
    expect(buildSpotlightQuery(parseCriteria({ pattern: "*" }))).toBe(
      "kMDItemContentTypeTree == 'public.item'",
    );
  });
});

describe("ranking", () => {
  const now = Date.now();
  it("prefers better matches, then recent files, then shallow ones", () => {
    const base = { matchQuality: 0.6, modifiedTimeMs: now, depth: 0 };
    expect(rankScore({ ...base, matchQuality: 1 }, now)).toBeGreaterThan(rankScore(base, now));
    expect(rankScore(base, now)).toBeGreaterThan(
      rankScore({ ...base, modifiedTimeMs: now - 90 * 86_400_000 }, now),
    );
    expect(rankScore(base, now)).toBeGreaterThan(rankScore({ ...base, depth: 3 }, now));
  });

  it("scores an exact name above a prefix above a substring", () => {
    expect(nameMatchQuality("plan.md", "plan")).toBe(1);
    expect(nameMatchQuality("planning.md", "plan")).toBe(0.8);
    expect(nameMatchQuality("old-plan.md", "plan")).toBe(0.6);
  });
});

describe("formatting", () => {
  it("prints short human sizes", () => {
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(12 * 1024)).toBe("12 KB");
    expect(formatSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });

  it("leaves short lines alone", () => {
    expect(truncateLine("short", 10)).toBe("short");
  });
});
