# CLI

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M0 |
| **Owns** | `src/cli/` |

## Purpose

Everything the user sees and types. The CLI starts a session, reads input, hands each prompt to the agent loop, and draws what comes back. It holds no agent logic: it renders an event stream and answers approval prompts.

## Requirements

- CLI-1, CLI-2, CLI-3, CLI-4, CLI-5: REPL, one-shot mode, slash commands, tool-call lines, cancellation.
- CLI-8, CLI-10, CLI-11: status line, path attachments, `--json` output.
- CLI-6, CLI-7, CLI-9, the front end only: the `wipe` subcommand and the `--ephemeral` and `--resume` flags call [storage](storage.md).
- FS-7 and PERM-7, the drawing only: the approval prompt shows the preview and offers the choices.
- MOD-5, the flag only: `--model`.

## Provides

- The `vix` entry point and argument parsing.
- The REPL: input line, streamed output, status line.
- One-shot mode: `vix -p "prompt"`, piped stdin, exit status.
- A slash command dispatcher that accepts `SlashCommand` registrations.
- The `ApprovalPrompter` implementation.
- The interactive model picker used by `/model`.
- The setup flow (D73): `vix config` and `/config`, in `src/cli/setup/`.

### Slash commands

The CLI owns dispatch, `/help`, `/exit`, `/clear`, and `/config`. Every other command is registered by the part that owns the feature.

| Command | Behaviour owned by |
|---|---|
| `/help`, `/exit`, `/clear`, `/config` | cli |
| `/model` | [lmstudio](lmstudio.md) (the picker widget is cli's) |
| `/context`, `/compact` | [context](context.md) |
| `/think` | [agent-loop](agent-loop.md) |
| `/permissions` | [permissions](permissions.md) |
| `/undo` (FS-9) | [files](files.md) |

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `runTurn` returning `AgentEvent`s | agent-loop | A generator that yields a canned event list |
| `LmClient.listModels` | lmstudio | Scripted `LmClient` |
| Usage snapshot for the status line | context | Fixed numbers |
| `VixPaths`, session store, `wipe` | storage | Temporary `VixPaths` |

## Design notes

- **Startup budget.** The REPL must be interactive in under 500 ms (PRD section 9). Import nothing heavy at startup: no DuckDB, isolate, `sharp`, or Playwright until a tool needs it.
- **Ink is loaded only for the REPL.** Ink brings React and a larger dependency tree, which costs startup time. One-shot mode and `vix wipe` draw plain text and must not import it. The startup measurement under "Done when" is the check that the 500 ms target still holds with Ink; if it does not, raise it with the user instead of missing the target quietly.
- **One-shot mode never prompts.** A call that would need approval is denied and the message names `--permission-mode`.
- **Cancellation.** Each turn gets an `AbortSignal`. The first `Ctrl+C` aborts it and returns to the prompt. A second press with no turn running exits.
- **Tool lines.** One line per `tool-start` and `tool-end` pair: tool, key argument, result size, duration. The key argument comes from the event, so the CLI needs no knowledge of individual tools.
- **Reasoning.** `reasoning` events are shown dimmed or hidden, never mixed into the answer text.
- **Piped stdin.** Stdin can be large. Treat it like a tool result: over the cap, it goes to the result store and the prompt gets a preview and a handle.
- **One-shot exit status.** `0` done, `1` the turn failed or was denied, `2` usage error, `130` cancelled (see Decisions).
- **Attachments (CLI-10).** A dragged path arrives as text, often quoted or backslash-escaped. Detect paths that exist, and pass them to the agent loop as attachments instead of leaving them in the prose.
- **The token is never printed**, including in error output and `--json`.

## Not in this part

- Parsing tool calls, running tools, permission decisions.
- What each slash command does beyond dispatch.
- Reading or writing anything under `~/.vix/` directly; that goes through storage. The one exception is the setup flow, which reads `config.json` with config's `readConfigFile` and writes it with storage's `writePrivateFile`.

## Done when

- With the scripted `LmClient`: the REPL streams a reply, shows a tool line, and returns to the prompt.
- `vix -p` prints a result and exits with each documented status; piped stdin reaches the prompt.
- In one-shot mode a write is denied by default and applied with `--permission-mode auto-edit`.
- A test confirms the one-shot path does not load Ink.
- A test presses `Ctrl+C` during a slow fake turn and the REPL survives; a second press exits.
- Each slash command in CLI-3 dispatches to a registered handler; an unknown command prints help.
- Measured startup time on the reference machine is recorded and is under 500 ms.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Approvals in one-shot mode | Anything that would prompt is denied, with a message naming the `--permission-mode` flag. That flag pre-authorizes a mode, such as `auto-edit`, for the run (D14). |
| Terminal UI | Ink (D21). |
| `/clear` | Starts a new session with an empty context. The old session stays on disk and can be resumed (D32). |
| Seam to the other parts | The cli talks to the rest of vix only through a `Harness` and a `CliComposition` (`src/cli/harness.ts`). `src/cli/composition.ts` is the one file integration edits. It uses the `RunTurn`/`TurnInput`/`Attachment` contract (`src/contracts/turn.ts`) and the proposed `SessionStore`/`WipeReport` contract (`src/contracts/session-store.ts`). |
| One-shot exit status | `0` done, `1` failed, hit a limit, or had any approval denied (even if the model then finished), `2` usage error or invalid config file, `130` cancelled. |
| One-shot output | The answer streams to stdout; tool lines, denials, and errors go to stderr, so stdout stays scriptable. Reasoning is hidden. `--json` prints one JSON document on stdout instead. |
| Reading stdin in one-shot mode | Without `-p`, a non-terminal stdin is the prompt. With `-p`, stdin is read only when it is a pipe or a redirected file, so a stdin left open by a parent process cannot hang the run. |
| Attachments in the prose | An attached path is replaced by its file name in brackets, for example `[report.pdf]`; the attachment carries the absolute path. A line starting with a path (`/Users/...`) is a prompt, not a slash command. |
| Approval keys | `o` once, `a` always for this session, `d` deny and type feedback, `Esc` deny without feedback. `Enter` alone does nothing, so a stray key cannot approve a change. Ctrl+C at the prompt cancels the turn. |
| Ctrl+C | During a turn, the first press aborts it and the REPL stops waiting on the event stream at once, even if the producer is slow to notice. Any press arms exit; the next press exits unless another key came in between. |
| Flag combinations | `--ephemeral` with `--resume`, `--json` without one-shot mode, and `--yes` outside `wipe` are usage errors. `vix wipe` without `--yes` refuses when stdin is not a terminal. |
| Setup flow (D73) | `vix config` and `/config` run one flow: base URL (non-loopback warns, SEC-1 override explained but not offered), API token (hidden; tested at once with `GET /api/v1/models`; rejected means retry or skip, and skip leaves the saved token as it was), default model (numbered MOD-3 list when LM Studio answers, else a typed key), context length (capped at the model's maximum, D47), permission mode, allowed folders (saved as absolute paths; `-` means the start folder). Enter keeps each current value. A summary shows the token as `sk-…last4` at most; nothing is written until the user confirms. The file is merged with every key the flow does not own, validated with `configSchema`, and written at 0600 in a 0700 folder under `VIX_HOME`. A file that is not valid JSON or not a valid config is never overwritten. |
| `vix config` input | Plain readline, never Ink. Echo is off during the token question and between questions, so typed-ahead or pasted text cannot show the token. Ctrl+C or the end of input cancels and writes nothing (exit 0). |
| `/config` in the REPL | Questions use the REPL's input line (`SlashCommandContext.ask`); a secret answer is drawn as asterisks and kept in scrollback as `(hidden)`. After saving, the permission mode applies to the running session at once. Base URL, token, model, context length, and allowed folders apply on the next start, and the REPL says so (`/model` switches models now). |
| First run | When the REPL fails to start and stdin and stdout are both terminals, the cli asks LM Studio once more; if the cause is a missing or rejected token it offers the setup (y/N). After saving it asks the user to start vix again. One-shot and non-terminal runs only print the error, whose fix names `vix config`. |

## Startup measurement (2026-11-17)

Apple M3 Pro, 18 GB, Node 22.22.2, built `bin/vix.js` with the placeholder composition (no real parts wired), 10 runs after one warm-up, in a pseudo-terminal:

- REPL, spawn until the input prompt and status line are drawn: median 249 ms (246 to 280 ms). Ink and React are included.
- `vix -p "hi"`, spawn to exit: median 81 ms (77 to 139 ms). Ink is not loaded (`src/cli/startup.test.ts`).

Re-measured 2026-11-17 after integration (real harness wired; built `bin/vix.js`; 10 runs after one warm-up). No LM Studio token was available, so the binary ran against the fake LM Studio HTTP server (`src/lmstudio/fake-lm-studio-server.test-support.ts`) with the model already loaded; the server check, model check, storage, and context engine are all real:

- REPL, spawn until the status line is drawn in a pseudo-terminal: median 278 ms (275 to 304 ms).
- `vix -p "hi" --ephemeral`, spawn to exit, one full chat turn included: median 199 ms (196 to 222 ms).
- `vix --version`: median 74 ms.

Not measured: the same against real LM Studio, where the model check and any reload add their own time.

## Open questions

None.
