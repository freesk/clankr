#!/usr/bin/env -S node --no-node-snapshot
// `--no-node-snapshot` is what isolated-vm documents as required on Node 20 and later.
// The spike ran without it, but the flag costs about 18 ms at startup and avoids an
// intermittent crash that a short spike cannot rule out. Passing it in the shebang
// means the bin never re-launches Node. See PRD section 13.1, D35.
import "../dist/cli/main.js";
