# Storage and sessions

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M0 (paths, ephemeral, wipe), M5 (resume) |
| **Owns** | `src/storage/` |

## Purpose

Own every byte the harness writes under `~/.vix/`. Transcripts and stored results can contain sensitive cell values (SEC-6), so there must be exactly one place that knows where files go, what permissions they get, and how to remove them. If every part writes through this one, `vix wipe` and `--ephemeral` are each a single operation instead of a hunt.

## Requirements

- CLI-6: `vix wipe`.
- CLI-7: `--ephemeral`.
- CLI-9: saved sessions and `--resume`.
- SEC-5, SEC-6: location, user-only permissions, retention under the user's control.
- Decision D12 in the PRD.

## Provides

- `VixPaths`: the location of the config file, the theme file, the audit log, and the current session directory with its subdirectories.
- The session store: append to a transcript, list sessions, load one for resume.
- `wipe()`.
- Ephemeral mode.

### Proposed layout

```
~/.vix/
  config.json
  theme.json
  logs/audit.jsonl
  sessions/<session-id>/
    transcript.jsonl      messages, appended as they happen
    results/              the result store (context)
    snapshots/            file snapshots for /undo (files)
    tmp/                  engine scratch space, such as DuckDB spill files (sql)
```

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `Config` | foundation | Real |

## Design notes

- **Nobody else builds a path under `~/.vix/`.** Other parts ask `VixPaths`. This is the rule that makes wipe and ephemeral trustworthy.
- **Permissions.** Directories are created as `0700` and files as `0600`, set explicitly and not left to the umask.
- **Transcripts are append-only** JSON Lines, so a crash loses at most the line being written.
- **Wipe** removes sessions, stored results, snapshots, scratch files, and logs. It keeps `config.json` and `theme.json`, which are settings, not session data. It deletes permanently: the Trash rule (FS-6) is about the model's `delete` tool, and moving sensitive data to the Trash would defeat the purpose.
- **Ephemeral** still needs somewhere to put large results while the session runs. Proposed: a private session directory that is removed on every exit path, including signals, plus a sweep at the next startup for anything a crash left behind. No transcript and no audit log are written.
- **Scratch files count.** A query engine can spill data to disk. That scratch space lives inside the session directory so wipe and ephemeral cover it.
- **Resume.** Load the transcript and reopen the result directory so old handles still resolve. Do not restore the `ReadTracker`: files may have changed since, so an overwrite must be preceded by a fresh read. If the saved model is no longer available, fall back to the default and say so.
- **Chart outputs are the user's files.** They are written where the user asked, not under `~/.vix/`, and wipe does not touch them.

## Not in this part

- The format of stored results and the handle scheme (context).
- What goes into an audit line (permissions).
- Parsing `--ephemeral`, `--resume`, and `wipe` on the command line (cli).
- The content of `theme.json` (chart).

## Done when

- A test reads the mode bits of every created file and directory and finds `0600` and `0700`.
- After `wipe`, nothing remains under `~/.vix/` except the config and theme files.
- `wipe` asks before deleting and deletes nothing when the answer is no; `wipe --yes` does not ask.
- With three saved sessions, `--resume` opens the newest.
- After an ephemeral session, the directory tree is byte-for-byte unchanged, both on a normal exit and after an interrupt signal.
- A leftover ephemeral directory from a simulated crash is removed at the next startup.
- A saved session resumes with its messages, and a handle from before the restart still resolves.

## Decisions

Settled 2026-11-17. All four are recorded together as D32 in PRD section 13.1.

| Topic | Decision |
|---|---|
| `vix wipe` confirmation | Shows what will be deleted (session count and size) and asks. `vix wipe --yes` skips the question. |
| `vix --resume` | Opens the most recent session. There is no picker. |
| Retention | Sessions are kept until wiped. Nothing is deleted automatically. |
| `/clear` | Starts a new session; the old one stays on disk. |

## Open questions

None.
