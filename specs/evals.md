# Evals and the network test

| | |
|---|---|
| **Wave** | 1 (runner and fixtures), 2 (full runs) |
| **Milestone** | M5, with pieces used from M1 on |
| **Owns** | `evals/`, `test/network/` |

## Purpose

Prove the product claims in the PRD with a repeatable run instead of an impression. Two things live here: the golden task suite that measures whether a small model can drive the harness, and the test that shows nothing leaves the machine.

This part can start early. The runner and the fixtures need only the contracts, and each milestone's tasks become runnable as its tools land.

## Requirements

- PRD section 10: the golden task suite and its six metrics.
- SEC-2: no telemetry, analytics, crash reporting, or update checks.
- SEC-4: the automated no-network test for the browser, the isolate, and DuckDB.
- PERM-6: assert there is no shell tool.
- PRD section 9: one place that measures the performance targets.
- The exit criteria of each milestone in PRD section 11.

## Provides

- A task format and a runner.
- About 40 golden tasks covering scenarios S1 to S10.
- Fixture generators, including the 1,000,000-row file.
- A metrics report per run.
- The whole-process network test.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `runTurn` and its `AgentEvent`s | agent-loop | Scripted `LmClient`, to test the runner itself |
| The real `LmClient` | lmstudio | Required for a real run |
| Every tool | the tool parts | Tasks are skipped until their tools exist |

## Design notes

### Golden tasks

- **A task is data.** A prompt, a fixture to set up, and assertions. Adding a task should not need new code.
- **Assert on outcomes, not wording.** Check the state of the file system, the files produced, and facts in the answer. Never match the model's phrasing.
- **Each task runs in a clean temporary directory** with its own temporary `~/.vix/`, so tasks cannot affect each other or the user's real data.
- **Drive the loop directly** through `runTurn`, not by scraping terminal output. The event stream already carries what the metrics need.
- **The model is not deterministic.** Run each task 3 times. A task passes when at least 2 runs succeed, and the report also gives the pass rate over all runs.
- **Chart tasks check the artefact.** The output file exists, is a valid PDF, and the saved spec has the expected chart type and fields.

### Metrics

The six in PRD section 10. Each is computed from the event stream and the ledger, so the runner needs no special hooks in the product code:

- Pass rate, first-attempt valid tool calls, and chart attempts come from `AgentEvent`s.
- Tokens per task and context overflow come from the context engine's usage.
- Outbound connections come from the network test below.

### Fixtures

- **Synthetic only.** No real personal or company data is ever committed, since the whole point of the product is that such data stays private.
- **Large files are generated**, not stored in the repository.

### Network test

- Run a session that exercises every engine (a query, an isolate run, a chart render) and observe connection attempts from the harness and from every process it starts.
- The only allowed destination is the configured LM Studio address.
- Observing in-page request blocking is not enough; the test must see actual connection attempts, including from Chromium's own background services.
- Two observers run together. A recording loopback proxy catches anything that honours proxy settings. A system-level monitor samples the open sockets of `vix` and every child process, and catches what bypasses the proxy. Short-lived connections can fall between samples, which is why the proxy is there too.

### Performance

One script measures each target in PRD section 9 on the reference machine and prints a table. Other specs cite its output as their evidence.

## Not in this part

- Unit tests for each part. Those live with the part.
- The isolation mechanisms themselves (sql, sandbox, pdf). This part checks them from outside.

## Done when

- The runner executes a trivial task end to end with the scripted `LmClient` and writes a report.
- A deliberately failing task is reported as failing, with the reason.
- The network test fails when a test-only outbound connection is added on purpose, and passes without it.
- A full run against the target model produces all six metrics. If the target model is not downloaded, the run is recorded as made against another model, and the targets are recorded as not yet verified.

## Decisions

Settled 2026-11-17. All three are recorded together as D33 in PRD section 13.1.

| Topic | Decision |
|---|---|
| How connections are observed | Both layers: a recording loopback proxy, and a system-level monitor of the process tree's sockets. The test fails if either sees a destination other than LM Studio. |
| Repetitions | 3 runs per task. A task passes when at least 2 of 3 succeed. The per-run pass rate is reported as well. |
| When the suite runs | By hand, with `npm run evals` on the reference machine before each release. The report is saved in the repository. Unit tests and the network test run on every change. |

## Open questions

None.
