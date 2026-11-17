# Semantic search

| | |
|---|---|
| **Wave** | 4 |
| **Milestone** | After M5 (SRCH-9 is P2) |
| **Owns** | `src/semantic/`; `src/lmstudio/embeddings.ts`; `src/cli/index-command.ts` and `index-arguments.ts`; `src/app/search-index.ts` |

## Purpose

Find files by meaning when the exact words are unknown: "which documents talk about ending the contract early?". The user picks folders and indexes them; the model then searches the index with one read-only tool. Everything stays on the machine: the text is embedded by a model in LM Studio and stored under `~/.clankr/index/`.

## Requirements

- SRCH-9: semantic search over user-chosen folders with a local embedding model.
- SRCH-6, its share: ranked, capped, compact results, with the full list behind a handle.
- SRCH-7, its share: the default excludes apply to indexing.
- PERM-4: the deny list applies when a folder is indexed and again when results are shown.
- SEC-1: embeddings go only to the configured LM Studio host, through the one transport.
- SEC-5, SEC-6: the index is user-only on disk; `clankr wipe` deletes it.
- CLI-7: an ephemeral session may read an index and never writes one.
- CTX-5, CTX-8: `search_meaning` costs tokens only while an index exists.
- Decisions D90 to D94 in the PRD.

## Provides

- `clankr index <folder>` and `/index <folder>`: build an index, or bring one up to date. `--rebuild` starts from nothing; `--remove` deletes one; no folder (or `--status`) lists the indexed folders with file count, passage count, and age.
- `search_meaning` (`createSearchMeaningTool(config)`): `read` permission, group `semantic`, parameters `query` and optional `root`.
- `searchToolGroups(indexDirectory)`: `["semantic"]` while at least one index exists, for the agent loop's `availableToolGroups`.
- `LmClient.embed(request, signal)` in the contracts, implemented by the LM Studio client, the scripted fake, and the fake LM Studio server.
- `ClankrPaths.indexDirectory`.

### Code (`src/semantic/`)

| Module | Provides |
|---|---|
| `extract/` | `TextExtractor` and one implementation per kind: `plain-text.ts`, `textutil.ts`, `pdf-text.ts`. `indexableKindOf(name)` decides the kind by file name. |
| `chunking.ts` | `chunkSegments`: passages with a line range, and a page for PDFs. |
| `embedder.ts` | `Embedder`: the task prefixes and batching, over `LmClient.embed`. |
| `candidates.ts` | `findCandidates`: the walk, the excludes, the size limits, the path policy. |
| `build-index.ts`, `store-changed-files.ts` | `buildIndex`: one incremental run. |
| `index-location.ts` | File names in the index directory; `hasSearchIndex`. No DuckDB. |
| `index-database.ts`, `index-store.ts`, `index-search.ts` | One index file: open, schema, writes, and the cosine query. |
| `index-catalog.ts` | `readIndexCatalog`, `removeIndexedFolder`, `scopeFor`. |
| `search-folders.ts`, `search-meaning-tool.ts`, `format-passages.ts` | The query across folders, the tool, and its result format. |
| `index-requests.ts`, `index-report.ts` | `runIndexRequest`: what both commands run, and what they print. |
| `errors.ts` | `SearchIndexError` and `describeIndexFailure`. |

## Consumes

| Contract | From | Used for |
|---|---|---|
| `LmClient.embed`, `listModels` | lmstudio | Vectors; the "model not downloaded" check |
| `PathPolicy` | permissions | Refusing a protected folder, leaving out protected files, re-checking results |
| `ClankrPaths.indexDirectory` | storage | Where the index files go |
| `ResultStore` (through `buildHitList`) | context, search | The full ranked list behind a handle |
| `walk`, `ExcludeRules`, `looksBinary`, `runProcess`, `buildHitList`, the format helpers | search | Reused, not copied |
| The DuckDB loader | sql | `loadDuckDb()`, so DuckDB still loads lazily and once |

## Design notes

- **Indexing is a user command, never a model tool.** The model must not be able to start a mass read of a folder. `search_meaning` only reads what the user chose to index.
- **One index file per indexed folder**, named by a hash of the folder's real path. Each records its own embedding model and vector size, so folders indexed with different models cannot be mixed up, and removing one is deleting one file. A folder inside or around an already indexed folder is refused, because two indexes over the same files would return every passage twice.
- **The index is not the `query_sql` engine.** It is its own DuckDB instance on its own file. The locked engine lives in memory and may read only inspected data files, so model-written SQL cannot attach, read, or name the index (tested with six attempts). `~/.clankr` is also denied to every tool (D42).
- **Brute-force cosine similarity**, with DuckDB's built-in `array_cosine_similarity` over a `FLOAT[n]` column. No extension is installed or loaded.
- **Incremental runs.** Each file's size and modified time are stored. A run reads only new and changed files and drops files that are gone, protected, or no longer indexable. A file with no text (binary, scanned PDF) is stored with the reason and no passages, so it is not read again until it changes.
- **Cancelling keeps a usable index.** Each file is stored in one transaction. Ctrl+C stops between files, the index is marked unfinished, and the next run continues. A second Ctrl+C exits at once; DuckDB's write-ahead log covers that.
- **Fail before changing anything.** A run first asks the embedding model for one vector. A stopped LM Studio or a missing model fails there, with its fix, before a file is created or an old index deleted.
- **Model mismatch.** When `search.embeddingModel` differs from the model an index was built with (or the model's vector size changed), `clankr index` refuses, the tool skips that folder, and both name `clankr index --rebuild <folder>`.
- **Offered only with an index.** The agent loop asks `availableToolGroups` once at the start of each turn, which costs one directory listing and does not load DuckDB. The answer follows the disk, not the session, so it is not saved for `--resume`, and it cannot change between rounds of one turn (CTX-9).
- **Results.** One header line (root, passage count, index age), then one heading and one snippet line per passage, best first. A text file shows its line range, which is what `read_file` takes; a PDF shows the page; a Word-like document shows neither, because its lines exist only in the converted text. At most three passages come from one file.
- **Results are checked at query time.** Each path goes through `PathPolicy` again, so a file protected after indexing is not shown. A file edited since indexing is marked `[changed]`; a file that no longer exists is left out and counted in a note.
- **Readers do not block each other.** The tool opens an index read-only for the length of one call. A `clankr index` run in another terminal holds the file exclusively; a search during it says the index is being updated.

## Not in this part

- Spreadsheets. They are not indexed; the data tools read them (`inspect_data`, `query_sql`).
- Scanned PDFs and images. They need OCR, which clankr does not do.
- Document content search by exact words (SRCH-8, P1). It is still open in [search.md](search.md).
- Sub-agents. `delegate` does not offer `search_meaning`, to keep a sub-agent's fixed overhead small.
- Keeping an index fresh automatically. The user runs `clankr index <folder>` again; the tool states the index age and marks changed files.

## Done when

- A second run with nothing changed sends no passage to the embedding model. *Observed (test).*
- A changed file is embedded again alone; a deleted file leaves the index. *Observed (tests).*
- A protected file is not indexed, a protected folder is refused, and a file protected after indexing is not shown. *Observed (tests, and with the real path policy in the integration test).*
- With another embedding model configured, the command and the tool refuse and name the rebuild. *Observed (tests).*
- `clankr wipe` removes the index, after which the tool is no longer offered. *Observed (integration test).*
- `search_meaning` is in the request's tools only while an index exists. *Observed (agent-loop and integration tests).*
- The closest passage ranks first, and at most `search.meaningMaxHits` passages are shown with the rest behind a handle. *Observed (tests).*
- Ctrl+C on a real `clankr index` process exits 130 with a usable index, and the next run finishes it. *Observed (process test with SIGINT).*
- Every file in the index directory is `0600` and the directory `0700`. *Observed (test).*
- PDF extraction opens no connection and starts no fetch. *Observed (test).*
- Against real LM Studio: `nomic-embed-text-v1.5` embeds, an index is built, and a question whose words are not in the text finds the right file. **Not verified.** `src/semantic/live.test.ts` is written and was not run; the main session runs it with a token.
- A real model chooses `search_meaning` for a meaning question. **Not verified.**

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Who indexes | The user, with `clankr index` or `/index`. The model only queries (D90). |
| When the tool is offered | Only while an index exists, through a new `semantic` tool group that follows the disk (D90). |
| Store | One DuckDB file per folder under `~/.clankr/index/`, brute-force cosine, no extension, separate from `query_sql` (D91). |
| Text extraction | Plain text by the binary check; `textutil` for `.docx`, `.doc`, `.rtf`, `.odt`; `unpdf` 2.2.1 for PDF text layers (D92). |
| Embeddings | `POST /v1/embeddings` through the LM Studio transport; default model key `text-embedding-nomic-embed-text-v1.5`; task prefixes from config (D93). |
| Passages and results | About 1,200 characters with 200 overlap; 8 passages shown, up to 50 behind the handle (D94). |

Internal to this part:

| Topic | Decision |
|---|---|
| DuckDB or something simpler | DuckDB. It is already a dependency, keeps passages and vectors in one transactional file, and answers a query over 22,000 passages in about 100 ms. A flat file of vectors would need its own crash safety. |
| PDF library | `unpdf` 2.2.1, not `pdfjs-dist` directly. `pdfjs-dist` 6.5 is 37 MB installed, pulls an optional native canvas package, and prints three warnings into the terminal at import when that package is missing. `unpdf` ships a serverless PDF.js build in 3.5 MB with no dependencies, ran with no output, no socket, and no fetch, and needs Node 24, which clankr already requires. |
| `textutil` exit status | `textutil` exits 0 even when it cannot read a file. Empty output with text on standard error counts as a failure. |
| Paths in results | Relative to the working folder when inside it, otherwise in full with `~`, exactly as `search_content` shows them (`usablePath`). Paths relative to some other root were resolved against the working folder by the model and failed; that was found and fixed for `search_content` earlier. |
| Vector inserts | DuckDB data chunks through the appender, inside the file's transaction: about three times faster than appending row values (measured: 735 ms against 2,184 ms for 4,000 passages of 768 numbers). |
| Embedding batches | Passages of several small files share one request, up to `search.embeddingBatchSize` (32). |
| Limits | `search.indexMaxTextFileBytes` 2 MB, `indexMaxDocumentBytes` 30 MB, `indexMaxFiles` 20,000 per folder, `indexExtractTimeoutMs` 60 s. The walk has no time limit, because the user started it and can cancel it. |
| `/index` | A cli command, like `/config`: it runs the same request as `clankr index` through the composition, with the REPL's Ctrl+C as its cancel signal (`SlashCommandContext.signal`, new). In an ephemeral session it lists indexes and refuses to change them. |
| Model not loaded | Left to LM Studio's just-in-time loading, which is on by default. A failed request names that setting in its fix. |

## Measurements (2026-11-17)

Apple M3 Pro, Node 24.22.3, `scripts/measure/semantic-index.ts`: 2,000 Markdown files, 22,000 passages, dense fake vectors of 768 numbers. Four runs, while another agent was also using the machine. The embedding model is not part of these numbers; they are what clankr itself costs.

| What | Measured |
|---|---|
| First index (walk, path policy, read, chunk, store) | 3.4 to 4.3 s |
| Index file | 82 MB |
| Re-run with nothing changed | 0.10 to 0.12 s |
| Re-run with 20 files changed | 0.13 to 0.15 s |
| `search_meaning`, whole call (read the catalog, embed, search, check paths) | median 87 to 100 ms, slowest 110 ms |

Not measured: the same with the real embedding model, which will dominate a first index.

## Open questions

| Question | Settled by |
|---|---|
| Is `text-embedding-nomic-embed-text-v1.5` the key this machine's LM Studio reports? | `GET /api/v1/models` in the live test, which prints the embedding keys |
| How many passages per second does the real model embed, and does it load just in time? | The live test |
| Does Gemma 12B pick `search_meaning` over `search_content` for a meaning question? | A live turn |
