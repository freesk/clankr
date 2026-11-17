// Ink loads only for the REPL (specs/cli.md). Each case runs the real entry point in a
// fresh Node process with a resolve hook that records whether Ink or React was loaded.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const recordingHook = `
import { registerHooks } from "node:module";
const loaded = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    const match = /\\/node_modules\\/(ink|react)\\//.exec(result.url);
    if (match) loaded.add(match[1]);
    return result;
  },
});
process.on("exit", () => process.stderr.write("LOADED=" + JSON.stringify([...loaded].sort()) + "\\n"));
`;

const hookUrl = `data:text/javascript,${encodeURIComponent(recordingHook)}`;
const mainPath = fileURLToPath(new URL("./main.ts", import.meta.url));
const viewPath = fileURLToPath(new URL("./repl/view.ts", import.meta.url));

function run(script: string, argv: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--import", hookUrl, script, ...argv],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
  );
  const loaded = /LOADED=(.*)/.exec(result.stderr)?.[1];
  return {
    status: result.status,
    stderr: result.stderr,
    loaded: loaded ? JSON.parse(loaded) : undefined,
  };
}

describe("startup", () => {
  it("one-shot mode does not load Ink or React", () => {
    const result = run(mainPath, ["-p", "hello"]);
    expect(result.stderr).toContain("not wired yet");
    expect(result.status).toBe(1);
    expect(result.loaded).toEqual([]);
  });

  it("wipe, --help, and --version do not load Ink or React", () => {
    for (const argv of [["wipe", "--yes"], ["--help"], ["--version"]]) {
      expect(run(mainPath, argv).loaded).toEqual([]);
    }
  });

  it("the hook does see Ink when the REPL view is loaded", () => {
    expect(run(viewPath, []).loaded).toEqual(["ink", "react"]);
  });
});
