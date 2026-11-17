// semantic part (specs/semantic-search.md): search by meaning over folders the user chose
// (SRCH-9). The user builds an index with `clankr index` or `/index`; the model queries it
// with the read-only `search_meaning` tool, offered only while an index exists.

export type { BuildSummary } from "./build-index.ts";
export { describeIndexFailure, SearchIndexError } from "./errors.ts";
export type { Extractors } from "./extract/index.ts";
export { hasSearchIndex } from "./index-location.ts";
export { type IndexEnvironment, runIndexRequest } from "./index-requests.ts";
export { createSearchMeaningTool, searchMeaningToolName } from "./search-meaning-tool.ts";
export { searchToolGroups } from "./tool-groups.ts";
