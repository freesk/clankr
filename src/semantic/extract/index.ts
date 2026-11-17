// One extractor per indexable kind. Tests replace entries to index without `textutil`.

import type { IndexableKind, TextExtractor } from "./extractor.ts";
import { extractPdfText } from "./pdf-text.ts";
import { extractPlainText } from "./plain-text.ts";
import { extractWithTextutil } from "./textutil.ts";

export {
  type Extraction,
  type ExtractionOptions,
  type IndexableKind,
  indexableKindOf,
  type TextExtractor,
  type TextSegment,
  wordLikeExtensions,
} from "./extractor.ts";

export type Extractors = Record<IndexableKind, TextExtractor>;

export const defaultExtractors: Extractors = {
  text: extractPlainText,
  document: extractWithTextutil,
  pdf: extractPdfText,
};
