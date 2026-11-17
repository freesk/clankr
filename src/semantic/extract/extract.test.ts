import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPdf } from "../test-support.ts";
import { indexableKindOf } from "./extractor.ts";
import { extractPdfText } from "./pdf-text.ts";
import { extractPlainText } from "./plain-text.ts";
import { extractWithTextutil, textutilPath } from "./textutil.ts";

const options = () => ({ signal: new AbortController().signal, timeoutMs: 30_000 });
const sampleDocx = resolve(import.meta.dirname, "..", "..", "..", "samples", "board_report.docx");

let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "clankr-extract-"));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function fileWith(name: string, content: string | Uint8Array): Promise<string> {
  const path = join(folder, name);
  await writeFile(path, content);
  return path;
}

describe("indexableKindOf", () => {
  it("sorts files into text, Word-like documents, PDFs, and files never indexed", () => {
    expect(indexableKindOf("notes.md")).toBe("text");
    expect(indexableKindOf("Makefile")).toBe("text");
    expect(indexableKindOf("main.ts")).toBe("text");
    for (const name of ["a.docx", "b.DOC", "c.rtf", "d.odt"]) {
      expect(indexableKindOf(name)).toBe("document");
    }
    expect(indexableKindOf("scan.PDF")).toBe("pdf");
    for (const name of ["a.xlsx", "b.csv", "c.png", "d.zip", "e.mp4", "f.pptx", "g.numbers"]) {
      expect(indexableKindOf(name)).toBeUndefined();
    }
  });
});

describe("plain text", () => {
  it("reads a text file and drops a byte order mark", async () => {
    const path = await fileWith("bom.txt", "﻿first line\nsecond line\n");
    expect(await extractPlainText(path, options())).toEqual({
      segments: [{ text: "first line\nsecond line\n" }],
    });
  });

  it("skips a binary file, by content and not by name", async () => {
    const path = await fileWith("looks-like-text.txt", new Uint8Array([1, 0, 2, 0, 3]));
    expect(await extractPlainText(path, options())).toEqual({ skipped: "not text" });
  });
});

describe.skipIf(!existsSync(textutilPath))("Word-like documents through textutil", () => {
  it("converts an .rtf file, keeping paragraphs on their own lines", async () => {
    const path = await fileWith(
      "letter.rtf",
      "{\\rtf1\\ansi First paragraph of the letter.\\par Second paragraph.}",
    );
    const extraction = await extractWithTextutil(path, options());
    expect(extraction).toEqual({
      segments: [
        { text: expect.stringMatching(/^First paragraph of the letter\.\nSecond paragraph\./) },
      ],
    });
  });

  it("converts a .docx file", async () => {
    const extraction = await extractWithTextutil(sampleDocx, options());
    if (!("segments" in extraction)) throw new Error(`skipped: ${extraction.skipped}`);
    expect(extraction.segments[0]?.text).toContain("Board Report FY2025");
  });

  it("skips a file textutil cannot read, with the reason", async () => {
    // textutil exits 0 here and only complains on stderr.
    const extraction = await extractWithTextutil(join(folder, "missing.docx"), options());
    expect(extraction).toEqual({ skipped: "textutil could not read it" });
  });

  it("rethrows when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractWithTextutil(sampleDocx, { signal: controller.signal, timeoutMs: 30_000 }),
    ).rejects.toThrow();
  });
});

describe("PDF text", () => {
  it("returns the text layer one segment per page, with page numbers", async () => {
    const path = await fileWith(
      "two-pages.pdf",
      buildPdf([["Either party may end the contract early.", "Second line."], ["Renewal fees."]]),
    );
    expect(await extractPdfText(path, options())).toEqual({
      segments: [
        { text: "Either party may end the contract early.\nSecond line.", page: 1 },
        { text: "Renewal fees.", page: 2 },
      ],
    });
  });

  it("leaves out blank pages but keeps the numbering", async () => {
    const path = await fileWith("gap.pdf", buildPdf([["One."], [], ["Three."]]));
    const extraction = await extractPdfText(path, options());
    expect(extraction).toEqual({
      segments: [
        { text: "One.", page: 1 },
        { text: "Three.", page: 3 },
      ],
    });
  });

  it("skips a PDF with no text layer and a file that is not a PDF", async () => {
    const scanned = await fileWith("scanned.pdf", buildPdf([[], []]));
    expect(await extractPdfText(scanned, options())).toEqual({
      skipped: "no text layer (a scanned PDF?)",
    });
    const broken = await fileWith("broken.pdf", "not a pdf at all");
    expect(await extractPdfText(broken, options())).toEqual({ skipped: "not a readable PDF" });
  });

  it("opens no network connection, starts no fetch, and prints nothing", async () => {
    const connect = vi.spyOn(net.Socket.prototype, "connect");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const printed = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    try {
      const path = await fileWith("offline.pdf", buildPdf([["Offline text."]]));
      await extractPdfText(path, options());
      expect(connect).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const spy of printed) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
