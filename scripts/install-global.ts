// `npm run install:global`: puts a `clankr` launcher in ~/.local/bin that always runs this
// checkout with Node 24 from nvm, whatever Node the terminal is using (D77). It picks the
// newest installed 24.x at each start, so a Node 24 patch update needs no reinstall.
// Run `npm run build` after pulling changes; the launcher runs the built copy in dist/.

import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const binDirectory = join(homedir(), ".local", "bin");
const launcherPath = join(binDirectory, "clankr");
const marker = "# clankr launcher";

// Never overwrite a `clankr` file that this script did not write.
if (existsSync(launcherPath) && !readFileSync(launcherPath, "utf8").includes(marker)) {
  console.error(`${launcherPath} exists and was not written by clankr. Remove it first.`);
  process.exit(1);
}

const launcher = `#!/bin/sh
${marker}, written by \`npm run install:global\` in ${repository}.
# Runs clankr with the newest Node 24 that nvm has installed (PRD D77).
NVM_NODE_DIR="\${NVM_DIR:-$HOME/.nvm}/versions/node"
NODE24=$(ls -d "$NVM_NODE_DIR"/v24.* 2>/dev/null | sort -V | tail -1)
if [ -z "$NODE24" ]; then
  echo "clankr: Node 24 is not installed. Fix: nvm install 24" >&2
  exit 2
fi
exec "$NODE24/bin/node" --no-node-snapshot "${join(repository, "bin", "clankr.js")}" "$@"
`;

await mkdir(binDirectory, { recursive: true });
await writeFile(launcherPath, launcher);
await chmod(launcherPath, 0o755);
console.log(`Installed ${launcherPath}`);
if (!(process.env.PATH ?? "").split(":").includes(binDirectory)) {
  console.log(`Add ${binDirectory} to your PATH to run \`clankr\` from anywhere.`);
}
if (!existsSync(join(repository, "dist", "cli", "main.js"))) {
  console.log("Now run `npm run build`: the launcher runs the built copy in dist/.");
}
