import { describe, expect, it } from "vitest";
import { chunkSegments } from "./chunking.ts";

const options = { chunkCharacters: 1_200, overlapCharacters: 200 };

/** Numbered lines of a fixed length, so every character can be traced to its line. */
function numberedLines(count: number, lineLength = 60): string {
  return Array.from({ length: count }, (_, index) =>
    `line ${index + 1} `.padEnd(lineLength, "x"),
  ).join("\n");
}

describe("chunkSegments", () => {
  it("keeps a short text as one passage with its line range", () => {
    const chunks = chunkSegments([{ text: "first\nsecond\nthird\n" }], options);
    expect(chunks).toEqual([{ text: "first\nsecond\nthird", startLine: 1, endLine: 3 }]);
  });

  it("cuts long text into passages of about the configured size", () => {
    const chunks = chunkSegments([{ text: numberedLines(200) }], options);
    expect(chunks.length).toBeGreaterThan(8);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1_200);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.text.length).toBeGreaterThan(900);
  });

  it("starts each passage with the end of the one before, on whole lines", () => {
    const chunks = chunkSegments([{ text: numberedLines(200) }], options);
    for (let index = 1; index < chunks.length; index++) {
      const previous = chunks[index - 1];
      const current = chunks[index];
      if (!previous || !current) throw new Error("missing chunk");
      const sharedLines = previous.endLine - current.startLine + 1;
      expect(sharedLines).toBeGreaterThanOrEqual(1);
      // 200 characters of overlap is three 61-character lines.
      expect(sharedLines).toBeLessThanOrEqual(3);
      expect(current.endLine).toBeGreaterThan(previous.endLine);
      expect(
        previous.text.endsWith(current.text.split("\n").slice(0, sharedLines).join("\n")),
      ).toBe(true);
    }
  });

  it("covers every line, in order", () => {
    const chunks = chunkSegments([{ text: numberedLines(200) }], options);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(200);
    for (let index = 1; index < chunks.length; index++) {
      expect(chunks[index]?.startLine).toBeLessThanOrEqual((chunks[index - 1]?.endLine ?? 0) + 1);
    }
  });

  it("prefers to cut at a paragraph break", () => {
    const paragraph = (name: string) =>
      `${name} `
        .repeat(160)
        .trim()
        .match(/.{1,80}/g)
        ?.join("\n");
    const text = [paragraph("alpha"), paragraph("beta"), paragraph("gamma")].join("\n\n");
    const chunks = chunkSegments([{ text }], { chunkCharacters: 1_200, overlapCharacters: 0 });
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text.slice(0, 5))).toEqual(["alpha", "beta ", "gamma"]);
    expect(chunks[0]?.text).not.toContain("beta");
  });

  it("splits one very long line at sentence ends and keeps its line number", () => {
    const paragraph = "This sentence is exactly forty characters. ".repeat(100).trim();
    const chunks = chunkSegments([{ text: `Title\n${paragraph}\nEnd` }], options);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1_300);
    const middle = chunks[1];
    expect(middle).toMatchObject({ startLine: 2, endLine: 2 });
    expect(middle?.text.endsWith(".")).toBe(true);
  });

  it("cuts a line with no spaces mid-way instead of producing a huge passage", () => {
    const chunks = chunkSegments([{ text: "x".repeat(5_000) }], options);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1_200);
  });

  it("records the page of each segment and numbers lines within the page", () => {
    const chunks = chunkSegments(
      [
        { text: "page one\nsecond line", page: 1 },
        { text: "page three", page: 3 },
      ],
      options,
    );
    expect(chunks).toEqual([
      { text: "page one\nsecond line", startLine: 1, endLine: 2, page: 1 },
      { text: "page three", startLine: 1, endLine: 1, page: 3 },
    ]);
  });

  it("produces nothing for blank text and trims blank lines around a passage", () => {
    expect(chunkSegments([{ text: "\n\n   \n" }], options)).toEqual([]);
    expect(chunkSegments([{ text: "\n\nbody\n\n" }], options)).toEqual([
      { text: "body", startLine: 3, endLine: 3 },
    ]);
  });

  it("never repeats a passage when the overlap is as large as the passage", () => {
    const chunks = chunkSegments([{ text: numberedLines(40) }], {
      chunkCharacters: 200,
      overlapCharacters: 5_000,
    });
    const starts = chunks.map((chunk) => chunk.startLine);
    expect(new Set(starts).size).toBe(starts.length);
    expect(chunks.at(-1)?.endLine).toBe(40);
  });
});
