# PDF and image rendering

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M4 |
| **Owns** | `src/engines/browser/` |

## Purpose

Turn a validated Vega-Lite spec into a file. A headless Chromium page loads vendored Vega-Lite from disk, receives the spec and rows as data, draws the chart, and exports it as PDF, PNG, or SVG.

The browser is the most capable piece of software the harness starts, and it handles sensitive data. Two rules follow: it never runs model-written code, and it never touches the network.

## Requirements

- DATA-12: the page contains only vendored Vega-Lite, the validated spec, and the data.
- DATA-13: PDF by default; PNG and SVG available.
- DATA-14: fully offline; outbound requests blocked and logged.
- DATA-15, its share: page size, logo, and footer from the theme.
- DATA-19: multi-chart reports in one PDF.
- SEC-3, its share: Chromium and Vega-Lite are installed up front and loaded from disk. Fonts come from the system.
- SEC-4, its share: prove the browser has no network access.
- The memory risk row in PRD section 12.

## Provides

- `renderChart(request)`: takes a `ChartRenderRequest` (validated spec, rows, theme, format, output path) and returns the written file's path and size.
- `renderReport(blocks, theme, outputPath)` for DATA-19: charts and text blocks composed into one PDF.
- A PNG preview on request, for the chart self-check.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `ChartRenderRequest` | chart | Fixture specs and rows |
| Audit log writer, for blocked requests | permissions | In-memory log |

This part is the most independent of all: its input is plain data and its output is a file.

## Design notes

### Offline, in layers

1. **Page level.** Every request the page makes is intercepted. Only the local template and its vendored scripts are served; everything else is aborted and logged.
2. **Browser level.** Request interception covers pages, not the browser's own background traffic (update checks, component downloads, and similar). Launch Chromium with that traffic switched off and with name resolution pointed nowhere.
3. **Proof.** The SEC-4 test watches for real connection attempts from the browser process, not only for intercepted page requests.

### No model-written code

- The spec and rows are passed into the page **as data arguments**. They are never concatenated into a script or into HTML.
- A Vega-Lite spec can contain expression strings (for a filter or a calculated field). By default Vega compiles those into JavaScript functions. Use Vega's expression interpreter mode instead, which evaluates expressions without generating code, and set a content security policy on the page that forbids code generation. Then even a hostile spec cannot become script.

### Rendering

- **Start late, linger briefly.** Launch the browser only when a render is requested. Keep it for about 60 s after the last render, so a follow-up tweak or a self-check retry does not pay the cold start again, then close it. It holds memory beside the model for that minute, which is the accepted cost.
- **Never outlive `clankr`.** The browser is closed on every exit path, including a cancelled turn and an interrupt signal, whether or not the idle timer has fired.
- **A fresh page per render.** The process is reused; pages are not. Nothing from one chart's data is left in a page that a later render could see.
- **Wait for the chart.** Export only after fonts have loaded and the Vega view reports it has finished rendering. Exporting early is the classic cause of blank or half-drawn PDFs.
- **PDF** is vector, with the page size from the theme. The logo and footer are part of the page template, not of the chart spec.
- **PNG and SVG** come from the Vega view's own export, at a fixed scale, so output is the same on every run.
- **Fonts are local.** The default theme uses a macOS system font, so no font is shipped. A theme font that is not installed falls back to that default, with a note in the result.
- **Reports (DATA-19)** use one template with several chart containers and text blocks, exported as a single PDF with sensible page breaks.
- **Playwright and Chromium are installed by the vendoring step** and loaded lazily. Nothing is downloaded at run time.
- **Performance target:** chart to PDF in under 5 s once the data is aggregated (PRD section 9). The first chart of a session pays the browser launch inside that budget, so measure it cold as well as warm.

## Not in this part

- Running chart code, validating the spec, applying palette and fonts (chart).
- Choosing the output path (chart).
- PDF as an input format, a PRD non-goal.

## Done when

- A fixture spec renders to PDF, PNG, and SVG. The PDF has the theme's page size and one page; the SVG parses; the PNG has the expected dimensions.
- The logo and footer from a test theme appear in the PDF.
- A page that tries to fetch a remote resource has the request blocked, and the block appears in the log.
- A spec containing an expression renders correctly under the content security policy, and a spec containing a script injection attempt renders as inert text or fails without executing.
- The whole-process test observes zero outbound connection attempts during a render.
- A second render within the idle period reuses the browser process and uses a new page.
- No browser process remains once the idle period has passed, or after `clankr` exits, including after a failed render and after an interrupt.
- Cold and warm render times are measured on the reference machine and recorded.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Browser lifetime | Kept alive for about 60 s after the last render, then closed (D30). |
| Where Chromium is installed | Inside the project's `vendor/` directory, so `clankr wipe` cannot touch it (D31). |
| Default theme font | A macOS system font. No font is vendored (D31). |
| Browser build | Chrome headless shell 156.0.8078.4 for mac-arm64, the build `playwright-core` 1.64.1 expects, installed by the `chromium` vendor step (checksummed). Vega 6.4.0, Vega-Lite 6.5.0, and vega-interpreter 2.3.2 come from the npm registry tarballs via the `vega` step. |
| Default font | Helvetica Neue (`systemFontFamily`). Whether a theme font is installed is measured in the page; a missing one is swapped in the spec's `config` and noted in `ChartRenderResult.notes`. |
| Isolation per render | A fresh browser context and page per render, not only a fresh page. |
| Offline layer 1 | Context-level request interception serves only the page, its bootstrap, and the vendored scripts from a made-up `.invalid` origin. The CSP (no `unsafe-eval`, `connect-src 'none'`) stops some requests before interception; the page reports those through a binding, and both kinds go to the same blocked-request logger. |
| Offline proof | `offline.test.ts` polls `lsof` for every browser process during PDF, PNG, and SVG renders and expects no internet socket, with a positive control; a local canary server must see zero connections. |
| Logo and footer | Chromium's PDF header and footer templates. The logo is read on the host and passed as a data URL; the footer is escaped. |
| Chart size | A single view with no size is fitted to the printable area (PDF) or to 720 x 440 (PNG, SVG, preview). Composed views keep their size; the stylesheet scales them down. |
| Exits | Playwright's own SIGINT handler is off; Ctrl-C belongs to the CLI, which must call `close()`. On any process death the browser loses its pipe and exits; tests cover exit, SIGINT, SIGTERM, and SIGKILL. |
| Idle time | `config.data.browserIdleSeconds`, default 60. |
| Measured times | `make_chart` to PDF on the development machine (Apple silicon; not confirmed to be the M3 Pro reference): cold 853 ms (browser launch and schema compile), warm about 100 ms. The very first launch after `npm run vendor` took about 3 s (first-run checks by macOS). |

## Open questions

None.
