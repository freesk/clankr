import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAttachments } from "./attachments.ts";

const existing = new Set([
  "/Users/me/Pictures/Screen Shot 1.png",
  "/work/data/payroll.xlsx",
  join(homedir(), "notes.md"),
  "/tmp/a.png",
]);
const options = { workingDirectory: "/work", isFile: (path: string) => existing.has(path) };

describe("extractAttachments", () => {
  it("detects a dragged path with backslash-escaped spaces", () => {
    const input = extractAttachments(
      "what is in /Users/me/Pictures/Screen\\ Shot\\ 1.png ?",
      options,
    );
    expect(input.attachments).toEqual([
      { path: "/Users/me/Pictures/Screen Shot 1.png", kind: "image", label: "[Screen Shot 1.png]" },
    ]);
    expect(input.text).toBe("what is in [Screen Shot 1.png] ?");
  });

  it("detects quoted, relative, and home paths", () => {
    const input = extractAttachments(
      "compare '/Users/me/Pictures/Screen Shot 1.png' with ./data/payroll.xlsx and ~/notes.md",
      options,
    );
    expect(input.attachments.map((attachment) => attachment.kind)).toEqual([
      "image",
      "file",
      "file",
    ]);
    expect(input.text).toBe("compare [Screen Shot 1.png] with [payroll.xlsx] and [notes.md]");
  });

  it("keeps trailing punctuation in the prose", () => {
    const input = extractAttachments("look at /tmp/a.png.", options);
    expect(input.attachments[0]?.path).toBe("/tmp/a.png");
    expect(input.text).toBe("look at [a.png].");
  });

  it("accepts file URLs", () => {
    const input = extractAttachments("file:///tmp/a.png", options);
    expect(input.attachments[0]?.path).toBe("/tmp/a.png");
  });

  it("leaves missing paths and ordinary words alone", () => {
    const input = extractAttachments("read /tmp/missing.txt and the 1/2 split", options);
    expect(input.attachments).toEqual([]);
    expect(input.text).toBe("read /tmp/missing.txt and the 1/2 split");
  });
});
