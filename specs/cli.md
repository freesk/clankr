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

### Slash commands

The CLI owns dispatch, `/help`, `/exit`, and `/clear`. Every other command is registered by the part that owns the feature.

| Command | Behaviour owned by |
|---|---|
| `/help`, `/exit`, `/clear` | cli |
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
- **One-shot exit status.** Proposed: `0` done, `1` the turn failed or was denied, `2` usage error, `130` cancelled.
- **Attachments (CLI-10).** A dragged path arrives as text, often quoted or backslash-escaped. Detect paths that exist, and pass them to the agent loop as attachments instead of leaving them in the prose.
- **The token is never printed**, including in error output and `--json`.

## Not in this part

- Parsing tool calls, running tools, permission decisions.
- What each slash command does beyond dispatch.
- Reading or writing anything under `~/.vix/` directly; that goes through storage.

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

## Open questions

None.
