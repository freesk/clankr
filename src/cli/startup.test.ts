// Ink loads only for the REPL (specs/cli.md). Each case runs the real entry point in a
// fresh Node process with a resolve hook that records whether Ink or React was loaded.
// Node strips the types itself here, so this also checks that everything one-shot mode
// loads is erasable TypeScript (no enums, no constructor parameter properties).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

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

// The real ~/.vix is never touched: every run gets a private VIX_HOME. Without a token, a
// one-shot run stops at LM Studio's startup check whether or not LM Studio is running.
const scratch = mkdtempSync(join(tmpdir(), "vix-startup-"));
const vixHome = join(scratch, ".vix");
const environment: NodeJS.ProcessEnv = { ...process.env, VIX_HOME: vixHome };
delete environment.LM_API_TOKEN;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(script: string, argv: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--import", hookUrl, script, ...argv],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      env: environment,
      cwd: scratch,
    },
  );
  const loaded = /LOADED=(.*)/.exec(result.stderr)?.[1];
  return {
    status: result.status,
    stderr: result.stderr,
    loaded: loaded ? JSON.parse(loaded) : undefined,
  };
}

describe("startup", () => {
  it("one-shot mode loads the real harness but not Ink or React", () => {
    const result = run(mainPath, ["-p", "hello", "--base-url", "http://127.0.0.1:9"]);
    // The startup error and its fix (MOD-8): no token, or nothing listening on port 9.
    expect(result.stderr).toMatch(/Fix: /);
    expect(result.status).toBe(1);
    expect(result.loaded).toEqual([]);
    // A start that failed before the model connected leaves nothing on disk.
    expect(existsSync(join(vixHome, "sessions"))).toBe(false);
  });

  it("wipe, --help, and --version do not load Ink or React", () => {
    for (const argv of [["wipe", "--yes"], ["--help"], ["--version"]]) {
      expect(run(mainPath, argv).loaded).toEqual([]);
    }
  });

  it("vix config runs on readline without loading Ink or React", () => {
    // Stdin is closed, so the setup ends at its first question and saves nothing.
    const result = run(mainPath, ["config"]);
    expect(result.stderr).not.toMatch(/Error/);
    expect(result.status).toBe(0);
    expect(result.loaded).toEqual([]);
    expect(existsSync(join(vixHome, "config.json"))).toBe(false);
  });

  it("the hook does see Ink when the REPL view is loaded", () => {
    expect(run(viewPath, []).loaded).toEqual(["ink", "react"]);
  });
});
