#!/usr/bin/env -S node --no-node-snapshot
// `--no-node-snapshot` is what isolated-vm documents as required on Node 20 and later.
// The spike ran without it, but the flag costs about 18 ms at startup and avoids an
// intermittent crash that a short spike cannot rule out. Passing it in the shebang
// means the bin never re-launches Node. See PRD section 13.1, D35.

// clankr's sandbox binary is built for Node 24 only (D77). Under any other version it
// would start fine and then fail on the first SQL query or chart, so stop here instead.
const supportedMajor = 24;
const runningMajor = Number(process.versions.node.split(".")[0]);
if (runningMajor !== supportedMajor) {
  process.stderr.write(
    `clankr: needs Node ${supportedMajor} LTS, but this is Node ${process.versions.node}.\n` +
      "Fix: run `nvm use 24` in this terminal, or install the launcher with " +
      "`npm run install:global` from the clankr folder.\n",
  );
  process.exit(2);
}

await import("../dist/cli/main.js");
