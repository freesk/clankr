# File and folder tools

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M1 |
| **Owns** | `src/tools/fs/` |

## Purpose

Create, edit, move, copy, and remove files and folders, safely. Covers scenarios S3, S4, and S5. Every tool here changes the disk, so every tool here produces a preview and goes through the permission gate.

## Requirements

- FS-1: `write_file`.
- FS-2, FS-8: `edit_file`, with whitespace-tolerant matching as a fallback.
- FS-3: `make_dir`.
- FS-4, FS-5, FS-10: `move` and `copy`, single and multi-source.
- FS-6: `delete`, to the Trash.
- FS-7, its share: build the diff or one-line summary for each change.
- FS-9: `/undo`.
- Decision D7 in the PRD.

## Provides

- Six `ToolDefinition`s in the `core` group with `write` permission: `write_file`, `edit_file`, `make_dir`, `move`, `copy`, `delete`.
- A `previewChange` for each.
- The `/undo` slash command.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `PathPolicy` | permissions | Fake with a fixed deny list |
| `ReadTracker` | filled by `read_file` in search | In-memory set, filled by the test |
| `VixPaths` (snapshot directory) | storage | Temporary `VixPaths` |

The permission gate is called by the agent loop, not by these tools. A tool can assume that when `run` is called, the change was approved.

## Design notes

- **Previews.** A text edit previews as a unified diff. A new file previews as its first lines and its size. Move, copy, delete, and `make_dir` preview as one line. The preview must describe exactly what `run` will do.
- **Read before overwrite (FS-1).** `write_file` on an existing path checks the `ReadTracker`. If the file was not read, or changed on disk since it was read, refuse and tell the model to call `read_file` first.
- **`edit_file` failures are instructions.** No match: say so and suggest reading the surrounding lines. Several matches: say how many, and suggest a longer `old` string or the replace-all option.
- **Whitespace tolerance (FS-8)** is a fallback after the exact match fails, and applies only when it yields exactly one match. The preview shows the real text being replaced.
- **Preserve the file's shape.** Keep its line endings and its trailing newline state.
- **Atomic writes.** Write to a temporary file in the same directory, then rename, so a crash cannot leave a half-written file.
- **Text only.** Refuse to write or edit binary files.
- **Never overwrite silently.** `move` and `copy` refuse when the target exists, and name the target in the error.
- **Trash.** `delete` moves to the macOS Trash through the `trash` npm package, and nothing in this part unlinks a user file. The package ships a prebuilt helper binary, so pin its version and confirm it runs offline.
- **Multi-source (FS-10).** A list of sources is one tool call, one preview, and one approval. Validate every source before moving any, so a failure does not leave the job half done.
- **Snapshots.** Before a change, save a full copy of what it touches under the session's snapshot directory. There is no size limit. `/undo` reverses the most recent change and refuses, with an explanation, if the file changed again outside the harness.
- **Only the newest snapshot is kept.** Undo is single level, so a snapshot becomes useless as soon as the next change is made, and is removed then. Disk use is bounded by the size of one change.

## Not in this part

- The approval decision and the allowed-root rules (permissions).
- Reading files (search).
- Bulk rename by pattern and zip or unzip, which are PRD non-goals.
- `vix wipe`, which deletes permanently and belongs to storage.

## Done when

In a temporary directory:

- Each tool has tests for the success path and for every refusal named above.
- `write_file` overwrites after a read and refuses without one.
- `edit_file` handles zero, one, and many matches, and the whitespace fallback.
- `move` and `copy` refuse an existing target; a multi-source call with one bad source changes nothing.
- A deleted file is found in the Trash and can be restored by hand.
- `/undo` reverses an edit, a write, and a move. A second `/undo` reports that there is nothing more to undo.
- After two changes, only the second change's snapshot is on disk.
- Each preview matches the change that is then applied.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| Trash mechanism | The `trash` npm package (D26). |
| Undo depth | Single level. `/undo` reverts the most recent change; a second `/undo` says there is nothing more to undo (D27). |
| Snapshot size | Every change is snapshotted in full, with no size limit (D27). |

## Open questions

None.
