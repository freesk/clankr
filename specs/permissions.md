# Permissions

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M1 |
| **Owns** | `src/permissions/` |

## Purpose

Decide whether a tool call may run. This part holds the permission mode, the allowed roots, the deny list, the grants made during a session, and the audit log. It is the implementation of PRD principle 5: reads are free, changes need consent.

## Requirements

- PERM-1, PERM-2, PERM-3, PERM-4, PERM-5: modes, free reads, allowed roots, deny list, execute-class and delete prompts.
- PERM-7, PERM-8: approval choices, audit log.
- FS-7, its share: decide whether a preview is shown before a change is applied.
- SEC-7, its share: nothing read from a file can grant permission.
- Decisions D14, D19, and D20 in the PRD.

## Provides

- The `PermissionGate` implementation.
- The `PathPolicy`: classify a path as inside an allowed root, outside, or denied.
- The audit log writer.
- The `/permissions` slash command: show and change the mode and the session grants.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `ApprovalPrompter` | cli | Queue-backed fake |
| `ChangePreview` | each write or execute tool | Hand-built previews |
| `VixPaths` (audit log location) | storage | Temporary `VixPaths` |
| `Config` (allowed roots, deny list, default mode) | foundation | Real |

## Design notes

### Decision table

| Mode | `read` | `write` inside allowed roots | `write` outside | `delete`, `execute` |
|---|---|---|---|---|
| ask | run | ask | ask | ask |
| auto-edit | run | run | ask | ask, unless granted for the session |
| read-only | run | refuse | refuse | refuse |

A path on the deny list is refused in every mode, for reads as well as writes, and is never offered as a prompt.

### Paths

- **Canonicalize before classifying.** Resolve `~`, relative segments, and symbolic links to a real path, then compare. Otherwise a link inside an allowed root can point at `~/.ssh`.
- **A target that does not exist yet** (a new file) is classified by its nearest existing parent.
- **Case.** The default macOS file system is case-insensitive, so comparisons must be too.
- **The deny list applies to reads.** Search, image, and data tools call `PathPolicy` before opening a file, and search results under denied paths are dropped.
- The concrete default deny list (the PERM-4 categories turned into paths) is defined here, in one place.

### Approvals

- A prompt offers: once, always for this session, or deny with feedback. Feedback is returned to the model as the tool's error text.
- Session grants for `write` tools and `delete` are keyed by tool.
- Session grants for the execute class are keyed by data file. The first `query_sql` or `run_js` against a file asks; the grant then covers later queries, scripts, and `make_chart` calls on data from that file for the rest of the session. Later calls are still shown as tool lines and written to the audit log.
- A chart's output file is a separate matter: it is a write, so a location outside the allowed roots asks even when the data file is already granted.
- A refusal message tells the model what would work instead, for example that the session is read-only.
- With no `ApprovalPrompter` available (one-shot mode), anything that would ask is denied, and the message names the `--permission-mode` flag described in [cli.md](cli.md).

### Audit log

- One line per tool call: time, tool, arguments, decision, outcome.
- The API token never appears. Arguments can contain sensitive values, so the file follows the storage rules in SEC-5 and is not written in an ephemeral session.

## Not in this part

- Drawing the prompt (cli).
- Building the diff or summary (the tool that makes the change).
- The isolation of DuckDB, the isolate, and the browser. Those are separate defences, described in their own specs.

## Done when

- A table-driven test covers every cell of the decision table.
- A symbolic link inside an allowed root that points to a denied path is refused.
- A read of a denied path is refused in every mode.
- "Always for this session" suppresses the next prompt for the same grant and does not survive into a new session.
- After one approved query on a data file, a second query and a chart from that file do not prompt; a query on a different file does.
- Deny-with-feedback reaches the fake model as the tool result.
- The audit log has one entry per call in a scripted session, and none in an ephemeral one.

## Decisions

Settled 2026-11-17. A D-number means the decision is also recorded in PRD section 13.1.

| Topic | Decision |
|---|---|
| How often `query_sql` and `run_js` prompt | Once per data file per session (D19, resolves O2). |
| `make_chart` approval | Covered by the data file's grant. Writing the output file still follows the write rules in PERM-3 (D19). |
| `delete` in auto-edit mode | Still asks, as PERM-5 says, unless granted for the session (D20). |
| No prompter available (one-shot mode) | Anything that would ask is denied, unless `--permission-mode` pre-authorized it (D14). |

## Open questions

None.
