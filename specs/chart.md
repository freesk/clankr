# Chart generation

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M4 |
| **Owns** | `src/chart/`, `src/tools/data/make-chart.ts` |

## Purpose

Turn a chart request into a validated, themed Vega-Lite spec. The model writes a few lines of JavaScript that build a spec and call `render`; this part runs that code, checks the result, applies the user's theme, and hands a finished spec to the renderer. Covers scenarios S8 and S9.

Model-written code is the only chart path (decision D2), and the PRD expects a 12B model to get it wrong often. Most of this part's value is in the error messages that let the model fix its spec on the next attempt.

## Requirements

- DATA-10: `make_chart`.
- DATA-11: run in the isolate, validate against the Vega-Lite schema, return short fixable errors.
- DATA-15, its share: load `~/.clankr/theme.json` and apply palette and fonts. Page size, logo, and footer are applied by [pdf](pdf.md).
- DATA-16, its share: write the Vega-Lite reference text. [agent-loop](agent-loop.md) decides when it is loaded.
- DATA-17: the row cap.
- DATA-18: the vision self-check.
- DATA-20: save the SQL, chart code, and spec beside the output.
- SEC-3, its share: the Vega-Lite schema is vendored. The default theme uses a system font.
- Decisions D2, D3, D9 and the chart risk row in PRD section 12.

## Provides

- One `ToolDefinition`, `make_chart`, in the `data` group with `execute` permission.
- The theme loader and the built-in default theme.
- The Vega-Lite reference text with worked examples.

### What happens in one call

```
chart code ─► isolate ─► captured (spec, rows) ─► row cap ─► strip styling and
                render()                                      external references
   ─► apply theme ─► validate against schema ─► renderer ─► file path returned
                          │
                          └─► on failure: short error back to the model
```

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `runInIsolate` | sandbox | Tests start from a captured spec and rows, skipping the isolate |
| `renderChart` | pdf | Fake that writes a placeholder file |
| `ResultStore` (rows and provenance) | context | In-memory fake |
| `PathPolicy` (output location) | permissions | Fake |
| `view_image`'s sub-call, for the self-check | image | Scripted `LmClient` |

## Design notes

- **`render` captures; it does not draw.** Inside the isolate, `render(spec, rows)` only records its arguments. All checking and drawing happen on the host afterwards.
- **Row cap first.** Over the cap (DATA-17), stop before validation and tell the model to aggregate with `query_sql`.
- **The model does not style** (D9). Remove styling the model put in the spec, then apply the theme as the spec's configuration. Define exactly which properties count as styling, in one place.
- **No external references.** A Vega-Lite spec can point at a URL for its data or for an image. Reject these here, before the spec reaches the browser. The browser blocks them too; this is the first of two layers.
- **Data is attached by the harness.** Rows are passed to the renderer beside the spec, not pasted into it by the model.
- **Validation errors are rewritten.** A raw schema validator produces long, nested messages. Reduce each to the location in the spec, what was found, and what is allowed, and return only the first few. This rewriting is what the "render within 3 attempts" metric in PRD section 10 depends on.
- **The reference text is on a token budget** of about 1,000 tokens, 6% of the default window. That covers the rules for `render`, the chart types in the scenarios as minimal working examples, and the mistakes a small model makes most. A test measures it with the real token counter.
- **Output location.** With no path given, the chart is saved beside its data file. The source file is known from the row set's provenance. That folder is usually outside the allowed roots, so expect the write prompt from PERM-3 on most charts, including in auto-edit mode. The DATA-20 companion files go to the same folder.
- **Reproducibility (DATA-20).** Next to the output, save the chart code, the final spec, and the SQL that produced the rows. The SQL comes from the row set's provenance in the result store.
- **Self-check (DATA-18).** On a vision-capable model, render a small PNG preview before the output file is written, and ask one question about whether the chart is readable. If the check passes, write the file. If it fails, return the verdict to the model and ask for a corrected chart once. The second chart is written and returned with its own verdict; there is no second automatic retry.
- **The theme file is validated** with a schema. A broken theme produces a clear error for the user and falls back to the default; it does not fail the chart.

## Not in this part

- Running the browser and writing the PDF (pdf).
- Getting or aggregating the data (inspect, sql, sandbox).
- A declarative chart tool. D2 rules it out.

## Done when

- Starting from a captured spec and rows: a valid bar, line, and stacked bar spec each reach the renderer with the theme applied.
- An invalid spec returns an error short enough to fit the tool cap that names the bad property.
- A spec with a remote data or image reference is rejected.
- Rows over the cap return the aggregate-first message.
- Styling written by the model is absent from the final spec.
- A missing theme file uses the default; a malformed one reports the problem and uses the default.
- The code, spec, and SQL are found beside the output file.
- With no output path given, the chart lands beside the data file, and a second chart with the same title gets a numbered name.
- A failed self-check triggers exactly one retry; a second failure is reported, not retried.
- The reference text measures at or under its token budget.
- With the real isolate and renderer, scenario S8 produces a PDF from a fixture spreadsheet.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Default output location | Next to the data file the chart was made from, named from the chart title. If the name exists a number is appended; nothing is overwritten (D28). |
| Approval | `make_chart` is covered by the data file's session grant. The output file is a write and follows PERM-3 (D19). |
| Reference text budget | About 1,000 tokens. |
| Failed self-check | One automatic retry (D29). |
| Chart from more than one data file | The folder of the first data file reached when tracing the code's handles in order (the provenance's SQL tables, `inspect_data` paths, and `run_js` code, followed up to 3 levels). One rule that needs no prompt, and the SQL file beside the chart names every data file, so nothing is lost. Settled in wave 1; needs a PRD row. |
| Self-check retry and the metric | The automatic retry counts as an attempt toward "render within 3 attempts" (PRD section 10). The metric measures what the user waits for; not counting it would hide a failed first chart. Settled in wave 1; needs a PRD row. |
| How the retry is carried | A failed check returns the verdict and writes nothing; the tool remembers that the retry is spent, so the next `make_chart` call is written with its own verdict. The flag resets after a written chart. |
| Self-check wiring | `createMakeChartTool` takes an optional `selfCheck` and `renderPreview`. `createVisionSelfCheck(currentModel)` is the default implementation: one request, no tools, no history, PNG preview, answer starts PASS or FAIL. It skips models without vision. Integration may swap in image's sub-call. |
| Isolate wiring | `runInIsolate` and `createStandardHelpers` are injected. `render` is the one extra helper; every message meant for the model is a `ToolError`. `render` also accepts a handle string in place of rows. Limits come from `config.data`, as for `run_js`. |
| What counts as styling | Defined once in `src/chart/styling.ts`: top-level `config`, `background`, `padding`; mark `color`, `fill`, `stroke`, font properties; fixed `value` and `scale.scheme`/`scale.range` on `color`, `fill`, `stroke`; any font or colour property of a title, axis, legend, or header. |
| External references | Any `url` key anywhere in the spec, and the `image` mark, are rejected before the browser. |
| Field check | A field that is not a column is reported with the column list. Only checked for specs without transforms or repeat, where it cannot misfire. |
| Validation errors | Ajv over the vendored schema. The deepest failing location wins; a property is "unknown" only if no alternative accepts it; enum lists get a "Did you mean" hint. At most 3 messages. |
| Companion files | `<name>.chart.js`, `<name>.vl.json`, `<name>.sql`, beside `<name>.<format>`. A number is appended if any of the four exists. An explicit `output_path` gets a number too rather than overwriting. |
| Reference text export | `chartToolReference` = `{ toolName, text, triggerWords }`, the shape agent-loop's `ToolReference` expects. |

## Open questions

None.
