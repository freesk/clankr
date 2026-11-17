# LM Studio client

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M0 |
| **Owns** | `src/lmstudio/` |

## Purpose

The single module that talks to LM Studio, and the only code in the harness allowed to open a network connection. It lists models, loads and unloads them, streams chat completions, and counts tokens. Keeping it in one place is the PRD's mitigation for LM Studio API changes (section 12).

## Requirements

- MOD-1, MOD-2, MOD-3, MOD-4, MOD-5: connection, token, model list, load and switch, default model.
- MOD-8: startup errors, each with a fix.
- MOD-9, MOD-10: per-model profiles, unload on switch.
- SEC-1: loopback only unless explicitly overridden.
- MOD-6, its share: report each model's capabilities. Gating belongs to [agent-loop](agent-loop.md).
- MOD-7, its share: announce a model change. Recalculating budgets belongs to [context](context.md).
- CTX-7, its share: send the reasoning setting with each request.
- PRD section 6.1 and decision D23 (minimum LM Studio version).

## Provides

- The `LmClient` implementation.
- The `/model` slash command: the formatted list for MOD-3, and `/model <key>` for direct switching.
- A model-changed notification that other parts subscribe to.
- Typed startup errors, each carrying the fix text to show the user.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `Config` (base URL, token, default model, profiles) | foundation | Real |
| Model picker widget | cli | Not needed for tests; `/model <key>` covers switching |

## Design notes

- **Endpoints** are the ones in PRD section 6.1: OpenAI-compatible chat for completions, the native API for listing, loading, and unloading, and `@lmstudio/sdk` for token counting.
- **Loopback check.** Resolve the configured host before the first request and refuse anything that is not a loopback address, unless the config carries an explicit override. The SDK opens its own connection, so the same check must cover it.
- **The token is a secret.** It appears in one header and nowhere else: not in logs, error messages, the audit log, transcripts, or model context. Error text built from a failed request must be scrubbed.
- **Stream events.** `chat` yields text deltas, reasoning deltas, tool-call deltas, and a final usage record as separate event kinds. The agent loop assembles them; this module does not interpret tool calls.
- **Usage is the source of truth** for token counts after each call. Confirm in M0 that the streaming endpoint reports usage; if it does not, fall back to a count request after the stream ends.
- **Loading.** Pass the configured context length when loading. A model can already be loaded with a different context length: read `loaded_instances[].config.context_length`, and if it differs, unload and load again with the configured length. A reload takes time and interrupts anything else using that loaded model, so tell the user what is happening and why before starting it.
- **Version check.** Read the LM Studio version at startup. Below 0.4.0, print a warning that names the minimum version and continue.
- **Cancellation.** Aborting the signal closes the HTTP stream promptly, so `Ctrl+C` stops generation in LM Studio and not only in the terminal.
- **Startup errors (MOD-8).** Four cases, each detected distinctly: server not reachable, token missing or rejected, model not downloaded, model failed to load.

## Not in this part

- Building the message list, tool schemas, or system prompt (agent-loop).
- Deciding what to do when a model lacks vision or tool training (agent-loop).
- Compacting after a switch (context).

## Done when

- Against the running LM Studio: list models with the MOD-3 fields, load a model with a chosen context length, stream a chat reply, count tokens for a message list, switch models mid-session.
- Against a local fake HTTP server: each of the four MOD-8 errors produces its own message and fix.
- A test proves a non-loopback base URL is refused without the override.
- A model loaded with a different context length is reloaded with the configured one, and a failed switch leaves the session on the previous model.
- A test searches all captured log and error output for the token and finds nothing.

Appendix A of the PRD notes the target `google/gemma-4-12b-qat` is not downloaded yet. Until it is, verification runs against `google/gemma-4-e4b`, and results must say so.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Model loaded with a different context length | Reload it with the configured length (D22). |
| Minimum LM Studio version | 0.4.0. Older versions get a warning at startup and `vix` continues (D23, resolves O4). |
| New model fails to load | The session stays on the previous model and the error is shown with its fix. If the previous model was unloaded to make room, it is loaded again. |

## Open questions

None.
