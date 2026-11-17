# CLAUDE.md

`vix` is a local-only CLI agent harness for LM Studio models, written in TypeScript on Node.js. Requirements, decisions, and milestones live in [PRD.md](PRD.md). Read it before making design choices, and update it when a decision changes.

## Rules

### 1. Commit to `main`

When asked to commit, commit directly to the `main` branch. Do not create a feature branch unless the user asks for one in that request.

### 2. No completion claims without evidence

Never say something is done, fixed, or working until you have seen evidence that it is.

- Evidence means output you observed in this session: a passing test run, a successful build, the command producing the expected result.
- Code that was written but not run is "written, not verified". Say exactly that.
- If verification is impossible (LM Studio is not running, the model is not downloaded), say what was not verified and why.
- Report failures with the actual output, not a summary of it.

### 3. No parallel agents without a roadmap on disk

Before starting parallel agents on a complex task, write a progress roadmap to `ROADMAP.md` in the repo root. A terminated session must be recoverable from that file alone.

The roadmap contains:

- The goal and the acceptance criteria.
- The task breakdown, with which agent owns each task.
- The status of each task: `todo`, `in progress`, `done (verified)`, or `blocked`.
- Decisions made along the way and the reason for each.
- The next step for every task that is not done.

Update it whenever a task changes state, not at the end. On resuming work, read `ROADMAP.md` first and continue from it.

### 4. No duplication; keep everything consistent

- Before writing a helper, type, or constant, search for an existing one and reuse it.
- When the same logic is needed in a second place, extract it rather than copy it.
- Follow the patterns already in the codebase: naming, file layout, error handling, tool definitions.
- When a change makes something else stale (the PRD, a type, a test, a doc comment), update it in the same change.

### 5. Keep code human-readable

Write for a person reading the file for the first time.

- Descriptive names over abbreviations.
- Small functions that do one thing.
- Straightforward control flow over clever one-liners.
- Comments explain why, not what.

### 6. No extra-large files

A very large source file is a sign of poor design, not a formatting problem.

- Treat about 300 lines as the point where a source file must be split by responsibility.
- Split along real boundaries (one tool, one engine, one concern per module). Do not split arbitrarily just to get under the number.
- If a file cannot be split cleanly, stop and raise the design problem with the user instead of letting it grow.

### 7. Load heavy modules lazily

DuckDB, `isolated-vm`, `sharp`, Playwright, and Ink are imported with `await import()` at the point of use, never at the top level of a module the CLI reaches at startup. A top-level import of any of them breaks the 500 ms startup target (PRD section 9).

## Working in the code

- `npm run lint` (Biome, then `tsc --noEmit`), `npm test` (vitest), `npm run build` (to `dist/`). Run all three before calling a change done.
- Shared types live in `src/contracts/`. Wave 1 parts import contracts and the fakes in `src/testing/`, never each other's code ([specs/README.md](specs/README.md)).
- Every config default is defined once, in `src/config/schema.ts`.
- Third-party run-time assets go in `vendor/` through a step in `scripts/vendor/` ([vendor/README.md](vendor/README.md)).
- Imports use `.ts` extensions; the build rewrites them.
