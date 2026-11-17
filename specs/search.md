# Search and read tools

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M1 |
| **Owns** | `src/tools/search/` |

## Purpose

Find files anywhere on the machine and read them. This is the primary use case in the PRD (section 5.3) and covers scenarios S1 and S2. All four tools are read-only, so they never prompt.

## Requirements

- SRCH-1, SRCH-2: `find_files` over the Spotlight index, with a directory-walk fallback.
- SRCH-3: `search_content`, backed by ripgrep.
- SRCH-4: `list_dir`.
- SRCH-5: `read_file`.
- SRCH-6, its share: ranking, the result cap, the compact format.
- SRCH-7: default excludes.
- SRCH-8: document content search (not built yet).
- SRCH-9, semantic search, is its own part: [semantic-search.md](semantic-search.md). It reuses this part's walk, excludes, binary check, process runner, hit list, and format helpers.
- SEC-3, its share: ripgrep is bundled, not fetched.
- The Spotlight risk row in PRD section 12.

## Provides

Four `ToolDefinition`s in the `core` group with `read` permission: `find_files`, `search_content`, `list_dir`, `read_file`.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `PathPolicy` | permissions | Fake with a fixed deny list |
| `ResultStore` | context | In-memory fake |
| `ReadTracker` | foundation (type), session state | Simple in-memory set |

## Design notes

- **Spawning fixed binaries is not a shell.** `mdfind` and ripgrep are started with an argument array, never through a shell and never with a command string built from model input. This keeps PERM-6 true in spirit as well as in name.
- **Spotlight queries.** Translate the flat tool arguments (name glob, type, size range, date range) into one metadata query. The model never writes query syntax.
- **Default root.** With no root given, `find_files` searches the home folder. The tool description says that passing `/` searches the whole machine.
- **Index health.** Detect when the index is disabled or does not cover the search root. Fall back to a directory walk and say so in the result, so the user knows why a search was slow or incomplete.
- **Document content (SRCH-8).** Use Spotlight's content index where it exists. Where it does not, extract text from the documents locally and search that, and say in the result that the slower path was used.
- **Ranking.** Recency, path depth, and match quality, combined in one documented function. Cap the list at a fixed count.
- **Compact format.** State the root once and print paths relative to it. One line per hit. Sizes and dates in short human form.
- **Return everything; let the loop cap it.** A tool returns its full ranked output, and the agent loop stores the overflow behind a handle. The tool itself only applies the hit-count cap.
- **Excludes.** One default list, defined once, shared by all three search paths (Spotlight, walk, ripgrep), overridable per call.
- **Denied paths** are filtered out of results and refused as roots.
- **`read_file`.** Reads a line range with line numbers. Detects binary content and refuses with a pointer: an image goes to `view_image`, a spreadsheet or document to `inspect_data`. Records each read in the `ReadTracker`, which `write_file` checks before overwriting (FS-1).
- **Long lines.** A minified file can be one enormous line. Truncate very long lines with a marker so a single line cannot blow the cap.
- **Performance targets** are in PRD section 9: whole-disk name search under 1 s, content search under 3 s on a 10 GB folder.

## Not in this part

- `read_result` (context).
- Profiling a data file (inspect) and reading an image (image).
- Any write.

## Done when

- Tests on a fixture tree cover each `find_files` filter, alone and combined.
- With the index reported as unavailable, the walk fallback returns the same files and the result says the fallback was used.
- `search_content` finds literal and regex matches and respects the default excludes.
- `read_file` returns the requested range with line numbers, and refuses a binary file with the right pointer.
- A search that would return a denied path does not include it.
- Timings for the two PRD targets are measured on the reference machine and recorded.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| How ripgrep is bundled | A pinned release fetched once by `npm run vendor`, checked against a checksum, and kept in `vendor/` (D31). |
| Default scope of `find_files` | The user's home folder. The whole machine is searched only when the model passes `/` as the root (D24). |
| Document content not indexed (SRCH-8) | Fall back to extracting text from the documents locally and searching that (D25). |

Settled while building wave 1 (2026-11-17), internal to this part:

| Topic | Decision |
|---|---|
| ripgrep version | 15.2.0, the macOS arm64 and x64 release archives, pinned by SHA-256 in `scripts/vendor/ripgrep.ts`. The step installs the archive for the machine's architecture to `vendor/ripgrep/rg`. |
| Parameter names | snake_case, matching the tool names: `min_size`, `modified_after`, `start_line`, `exclude`. |
| Spotlight is a pre-filter | The metadata query only narrows. Every path it returns passes the same `matchesCriteria` check as the walk, so both backends return the same files; Spotlight's own wildcard and diacritic rules cannot leak into results. |
| Index health check | Not covered when the root has a hidden segment, when `mdutil -s` does not report indexing enabled for the volume, or when Spotlight knows none of up to three of the root's visible children by name. A volume root skips the child probe. |
| Whole-machine scope | Root `/` runs `mdfind` with no `-onlyin`. Measured: `-onlyin /` takes about 2 s for a query that takes 0.2 s unscoped, and the child probe on `/` took up to 5 s. |
| Ranking | `0.5 * match + 0.3 * recency + 0.2 * shallowness`, each 0..1, documented in `ranking.ts`. Recency halves at 30 days; shallowness is `1 / (1 + depth)`. |
| Excludes | One list in `excludes.ts`, three pattern forms (a name, a segment sequence, an absolute folder). Checks run on the path relative to the root, so a root inside an excluded folder is searched normally. ripgrep runs with `--no-ignore --hidden` and the same list as globs, so `.gitignore` does not make it differ from the other paths. The per-call override is `exclude` (add patterns) on `find_files` and `search_content`; there is no switch to drop the defaults, and `list_dir` has no override, to save fixed overhead (CTX-5, see the [context](context.md) decisions). |
| Default root of `search_content` and `list_dir` | The working folder. A content search of the whole home folder is slow, and D24 covers only `find_files`. |
| Limits | New `search` section in the config: `maxHits` 50, `maxListEntries` 200, `maxLineLength` 300, `readFileDefaultLines` 200, `spotlightMaxResults` 20,000, `walkTimeLimitMs` 10 s, `walkMaxEntries` 500,000. |

## Measurements (2026-11-17)

Apple M3 Pro, macOS 26.6.2, warm runs, through the real tools (Spotlight query, stat, deny filter, ranking, formatting).

| Target (PRD section 9) | Measured |
|---|---|
| Whole-disk name search under 1 s | `*.pdf` 198 to 353 ms (341 hits); `invoice` 159 to 164 ms; images over 5 MB from the last year 405 ms; `report` 285 to 387 ms. Met. A broad home query (`*.md`, 48,000 raw Spotlight matches) took 1.4 to 3.3 s, almost all of it `mdfind` streaming paths. |
| Content search under 3 s on 10 GB of text | 1.9 to 3.0 s over 10,240 files of 1 MB (six runs: literal and regex, median about 2.2 s). The corpus had just been written, so much of it was likely in the page cache; a cold-cache run was not measured. At the limit, not clearly met. |

## Open questions

SRCH-8 (P1) is not built yet, and both questions below remain open for it. SRCH-9 was built in wave 4 ([semantic-search.md](semantic-search.md)).

- **Which extractors?** Semantic search now has offline extractors behind one interface (`src/semantic/extract/`): `textutil` for Word-like documents and `unpdf` for PDF text layers (D82). SRCH-8 can reuse them; `.xlsx` text would still come through DuckDB.
- **What bounds the fallback?** Extracting text from every document under a large folder is slow, and the content-search target in PRD section 9 is 3 s. Proposed: a limit on files and time, with the result saying how much was covered.
