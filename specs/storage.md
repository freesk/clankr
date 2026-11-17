# Storage and sessions

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M0 (paths, ephemeral, wipe), M5 (resume) |
| **Owns** | `src/storage/` |

## Purpose

Own every byte the harness writes under `~/.clankr/`. Transcripts and stored results can contain sensitive cell values (SEC-6), so there must be exactly one place that knows where files go, what permissions they get, and how to remove them. If every part writes through this one, `clankr wipe` and `--ephemeral` are each a single operation instead of a hunt.

## Requirements

- CLI-6: `clankr wipe`.
- CLI-7: `--ephemeral`.
- CLI-9: saved sessions and `--resume`.
- SEC-5, SEC-6: location, user-only permissions, retention under the user's control.
- Decision D12 in the PRD.

## Provides

- `ClankrPaths`: the location of the config file, the theme file, the audit log, and the current session directory with its subdirectories.
- The session store: append to a transcript, list sessions, load one for resume.
- `wipe()`.
- Ephemeral mode.

### Proposed layout

```
~/.clankr/
  config.json
  theme.json
  logs/audit.jsonl
  index/<hash>.duckdb     one semantic search index per indexed folder (semantic-search)
  sessions/<session-id>/
    transcript.jsonl      messages, appended as they happen
    results/              the result store (context)
    snapshots/            file snapshots for /undo (files)
    tmp/                  engine scratch space, such as DuckDB spill files (sql)
  ephemeral/<pid>-<session-id>/
    results/ snapshots/ tmp/   same as a saved session, but no transcript
```

The root is `$CLANKR_HOME` when that variable is set, otherwise `~/.clankr`. Tests always set an explicit root and never touch the real one.

### Code (`src/storage/`)

| Module | Provides |
|---|---|
| `layout.ts` | `resolveClankrRoot`, `buildClankrPaths`, `buildEphemeralClankrPaths`, `buildRootPaths`, `sessionDirectories`, `newSessionId`. The only place the layout is spelled out; `src/testing/temporary-clankr-paths.ts` builds through it. |
| `private-files.ts` | `ensurePrivateDirectory` (0700) and `appendPrivateFile` (0600), with the mode set by chmod after creation. |
| `session.ts` | `openSession({ root, ephemeral?, resumeSessionId? })` returns `{ paths, transcript, ephemeral, close() }`. Sweeps ephemeral leftovers first. |
| `transcript.ts` | `FileTranscript` (implements the `SessionTranscript` contract) and `DiscardingTranscript` for ephemeral sessions. |
| `session-store.ts` | `FileSessionStore` (implements the `SessionStore` contract) and `chooseResumeModel`. |
| `ephemeral.ts` | The ephemeral directory, its exit hooks, and `sweepEphemeralLeftovers`. |
| `wipe.ts` | `planWipe` and `wipe(root, { yes: true } \| { confirm })`. |

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `Config` | foundation | Real |

## Design notes

- **Nobody else builds a path under `~/.clankr/`.** Other parts ask `ClankrPaths`. This is the rule that makes wipe and ephemeral trustworthy.
- **Permissions.** Directories are created as `0700` and files as `0600`, set explicitly and not left to the umask.
- **Transcripts are append-only** JSON Lines, so a crash loses at most the line being written.
- **The search index is not session data, but it is wiped.** `index/` (`ClankrPaths.indexDirectory`) outlives sessions and is read by every session, ephemeral ones included (read-only, so nothing is written). It holds the text of the user's documents, so wipe deletes it like everything else ([semantic-search.md](semantic-search.md), D91).
- **Wipe** removes sessions, stored results, snapshots, scratch files, logs, and the search indexes. It keeps `config.json` and `theme.json`, which are settings, not session data. It deletes permanently: the Trash rule (FS-6) is about the model's `delete` tool, and moving sensitive data to the Trash would defeat the purpose.
- **Ephemeral** still needs somewhere to put large results while the session runs. Proposed: a private session directory that is removed on every exit path, including signals, plus a sweep at the next startup for anything a crash left behind. No transcript and no audit log are written.
- **Scratch files count.** A query engine can spill data to disk. That scratch space lives inside the session directory so wipe and ephemeral cover it.
- **Resume.** Load the transcript and reopen the result directory so old handles still resolve. Do not restore the `ReadTracker`: files may have changed since, so an overwrite must be preceded by a fresh read. If the saved model is no longer available, fall back to the default and say so.
- **Chart outputs are the user's files.** They are written where the user asked, not under `~/.clankr/`, and wipe does not touch them.

## Not in this part

- The format of stored results and the handle scheme (context).
- What goes into an audit line (permissions).
- Parsing `--ephemeral`, `--resume`, and `wipe` on the command line (cli).
- The content of `theme.json` (chart).

## Done when

- A test reads the mode bits of every created file and directory and finds `0600` and `0700`.
- After `wipe`, nothing remains under `~/.clankr/` except the config and theme files.
- `wipe` asks before deleting and deletes nothing when the answer is no; `wipe --yes` does not ask.
- With three saved sessions, `--resume` opens the newest.
- After an ephemeral session, the directory tree is byte-for-byte unchanged, both on a normal exit and after an interrupt signal.
- A leftover ephemeral directory from a simulated crash is removed at the next startup.
- A saved session resumes with its messages, and a handle from before the restart still resolves.

## Decisions

Settled 2026-11-17. All four are recorded together as D32 in PRD section 13.1.

| Topic | Decision |
|---|---|
| `clankr wipe` confirmation | Shows what will be deleted (session count and size) and asks. `clankr wipe --yes` skips the question. |
| `clankr --resume` | Opens the most recent session. There is no picker. |
| Retention | Sessions are kept until wiped. Nothing is deleted automatically. |
| `/clear` | Starts a new session; the old one stays on disk. |

Internal to this part, settled while building it (2026-11-17):

| Topic | Decision |
|---|---|
| Root override | `CLANKR_HOME` replaces `~/.clankr`, for tests and experiments. |
| "Most recent" session | The one whose transcript was written last, not the one started last. Sessions with no messages are not listed or resumed. |
| Empty sessions | The transcript and its header are created on the first message. `close()` removes a session directory that recorded nothing, so starting and quitting `clankr` leaves nothing behind. |
| Transcript records | One JSON object per line: a `session` header (format version, id, start time), `message`, and `model` (a model switch, so resume can reload it). A line that does not parse is skipped, since a crash can cut the last one. |
| Ephemeral location | `ephemeral/<pid>-<id>/` under the root. Parents that did not exist before are removed again, so the tree ends up byte-for-byte as it was. The process id lets the startup sweep leave a running session alone. |
| Ephemeral exit paths | Removed synchronously on `exit` (normal exit, `process.exit`, uncaught exception) and on SIGINT, SIGTERM, and SIGHUP, after which the signal is re-raised so the exit status is unchanged. If another listener owns the signal (the cli cancelling a turn on Ctrl-C), storage leaves it to that listener and cleans up on `exit`. SIGKILL and power loss are covered by the sweep. |
| Resume and ephemeral | Cannot be combined; `openSession` refuses. |
| Wipe scope | Everything at the top of the root except `config.json` and `theme.json`, including leftover ephemeral directories and the semantic search indexes in `index/`. The plan counts saved and leftover ephemeral sessions and their total size. With nothing to delete it does not ask. |

## Open questions

None.
