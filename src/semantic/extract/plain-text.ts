// Plain text files: anything `read_file` would accept, decided by the same binary check.

import { open } from "node:fs/promises";
import { looksBinary } from "../../tools/search/binary-content.ts";
import type { TextExtractor } from "./extractor.ts";

const byteOrderMark = "﻿";

export const extractPlainText: TextExtractor = async (path, options) => {
  const file = await open(path, "r");
  try {
    if (await looksBinary(file)) return { skipped: "not text" };
    const text = await file.readFile({ encoding: "utf8", signal: options.signal });
    return { segments: [{ text: text.startsWith(byteOrderMark) ? text.slice(1) : text }] };
  } finally {
    await file.close();
  }
};
