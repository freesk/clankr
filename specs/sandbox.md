# JavaScript sandbox

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M4 |
| **Owns** | `src/engines/isolate/`, `src/tools/data/run-js.ts` |

## Purpose

Run JavaScript written by the model, safely. The code runs in a V8 isolate that has no way to reach files, the network, the process, or other modules, because those APIs do not exist inside it (decision D1). It reaches data only through helpers the harness injects.

Two tools use the isolate: `run_js` for reshaping data, and `make_chart` for building a chart spec.

## Requirements

- DATA-8: `run_js` and the isolate's guarantees.
- DATA-9, its share: time, memory, and output limits; capped preview.
- DATA-11, its share: chart code runs in this same isolate.
- SEC-4, its share: prove the isolate has no network access.
- The `isolated-vm` risk row in PRD section 12.

## Provides

- `runInIsolate(code, helpers, limits)`: run code with a given set of injected helpers, and return its result, its captured log output, or a short error.
- The standard helpers: `data(handle)` to read a stored row set, and `save(name, rows)` to store one.
- One `ToolDefinition`, `run_js`, in the `data` group with `execute` permission.
- A `previewChange` that shows the code to be run.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `ResultStore.readRows` and `putRows` | context | In-memory fake |

[chart](chart.md) consumes `runInIsolate` and passes one extra helper, `render`.

## Design notes

- **One module wraps `isolated-vm`.** Nothing else in the codebase imports it. The PRD asks for this so the addon can be replaced if it breaks on a Node upgrade.
- **A fresh isolate per call.** No state survives from one call to the next, so one piece of model code cannot leave something behind for another.
- **The helper list is the whole attack surface.** Each helper is a narrow function that validates its arguments on the host side. Adding a helper is a security decision and belongs in a review.
- **Helpers are synchronous from the model's side.** `const rows = data("r12")` returns the rows. A small model then has no `await` to forget. The host does any waiting before or after the call.
- **Values cross by copy.** Rows are copied into the isolate and results are copied out. Nothing from the host, such as a function or an object with a prototype chain back to the host, is handed in by reference.
- **Limits are enforced by the host.** A memory limit on the isolate, and a wall-clock timeout that also stops asynchronous code and tight loops. A row cap on what `data` returns and on what `save` accepts, so a helper cannot be used to exhaust host memory.
- **Console output** is captured and returned as part of the tool result, subject to the cap. It is the model's only debugging aid.
- **Errors are short.** Message and line number in the model's own code. No host stack frames.
- **The addon is loaded lazily**, on first use.
- **Start-up flag.** `vix` runs Node with `--no-node-snapshot` (D35). Tests that load the addon run under vitest, which does not pass the flag; the spike saw no failure without it, but a crash seen only in tests should be checked against this first.

## Not in this part

- Reading files: the isolate cannot. Getting data out of a file is [sql](sql.md)'s job.
- The `render` helper and Vega-Lite validation (chart).
- The headless browser, which never runs model-written code (pdf).

## Done when

- Each of these fails inside the isolate, with a test per case: using `process`, `require`, a dynamic `import`, `fetch`, and reaching the host through a constructor chain.
- An infinite loop and an unresolved promise are both stopped by the timeout.
- Code that allocates without bound is stopped by the memory limit, and the harness process survives.
- A value saved in one call is not visible in the next, except through a handle.
- `save` followed by `data` round-trips a row set.
- Over-cap output returns a preview and a handle.
- A test confirms no network connection is attempted during any of the above.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Row-set format | JSON Lines, shared with [context](context.md) and [sql](sql.md) (D16). |
| Default limits | 5 s, 128 MB, and 50,000 rows, each configurable. The row limit is the same number as the chart row cap in DATA-17, defined once. |
| Helper style | Synchronous. `data`, `save`, and `render` return values directly, with no `await`. |
| Addon version | `isolated-vm` 6.2.0, pinned (D37). |

## Open questions

None.
