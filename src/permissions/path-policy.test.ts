import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RealPathPolicy } from "./path-policy.ts";

// A fake home folder in a temporary directory: the real one is never read.
let base: string;
let home: string;
let project: string;
let policy: RealPathPolicy;

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "vix-paths-")));
  home = join(base, "home");
  project = join(home, "project");
  await mkdir(join(home, ".ssh"), { recursive: true });
  await writeFile(join(home, ".ssh", "id_ed25519"), "secret key");
  await mkdir(join(project, "notes"), { recursive: true });
  await writeFile(join(project, "notes", "a.md"), "notes");
  await mkdir(join(home, "Elsewhere"), { recursive: true });
  policy = new RealPathPolicy({
    allowedRoots: [project],
    extraDeniedPaths: ["~/Private"],
    vixRoot: join(home, ".vix"),
    workingDirectory: project,
    homeDirectory: home,
  });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function classOf(path: string): Promise<string> {
  return (await policy.classify(path)).pathClass;
}

describe("RealPathPolicy", () => {
  it("classifies paths inside, outside, and on the deny list", async () => {
    expect(await classOf(join(project, "notes", "a.md"))).toBe("allowed");
    expect(await classOf(join(home, "Elsewhere"))).toBe("outside");
    expect(await classOf(join(home, ".ssh", "id_ed25519"))).toBe("denied");
    expect(await classOf(join(home, ".ssh"))).toBe("denied");
  });

  it("expands ~ and resolves relative paths against the working directory", async () => {
    expect(await policy.classify("notes/a.md")).toEqual({
      realPath: join(project, "notes", "a.md"),
      pathClass: "allowed",
    });
    expect(await classOf("~/.ssh/config")).toBe("denied");
    expect(await classOf("../.ssh/id_ed25519")).toBe("denied");
    expect(await classOf("notes/../../Elsewhere")).toBe("outside");
  });

  it("compares case-insensitively, as the default macOS volume does", async () => {
    expect(await classOf(join(home, ".SSH", "ID_ED25519"))).toBe("denied");
    expect(await classOf(join(project.toUpperCase(), "NOTES", "new.md"))).not.toBe("denied");
  });

  it("refuses a symbolic link inside an allowed root that points at a denied path", async () => {
    await symlink(join(home, ".ssh"), join(project, "keys"));
    await symlink(join(home, ".ssh", "id_ed25519"), join(project, "innocent.txt"));
    expect(await policy.classify(join(project, "keys", "id_ed25519"))).toEqual({
      realPath: join(home, ".ssh", "id_ed25519"),
      pathClass: "denied",
    });
    expect(await classOf(join(project, "innocent.txt"))).toBe("denied");
  });

  it("follows a dangling link to where a write through it would land", async () => {
    await symlink(join(home, ".ssh", "authorized_keys"), join(project, "drop.txt"));
    expect(await classOf(join(project, "drop.txt"))).toBe("denied");
    await symlink(join(home, "Elsewhere", "new.txt"), join(project, "out.txt"));
    expect(await classOf(join(project, "out.txt"))).toBe("outside");
  });

  it("classifies a file that does not exist yet by its nearest existing parent", async () => {
    expect(await classOf(join(project, "new", "deeper", "file.md"))).toBe("allowed");
    await symlink(join(home, "Elsewhere"), join(project, "linked"));
    expect(await policy.classify(join(project, "linked", "new", "file.md"))).toEqual({
      realPath: join(home, "Elsewhere", "new", "file.md"),
      pathClass: "outside",
    });
  });

  it("denies private key file names anywhere, even inside an allowed root", async () => {
    expect(await classOf(join(project, "deploy", "id_rsa"))).toBe("denied");
  });

  it("denies the vix root and paths added in config", async () => {
    expect(await classOf("~/.vix/config.json")).toBe("denied");
    expect(await classOf("~/Private/diary.txt")).toBe("denied");
  });

  it("denies when the deny list entry is itself a link", async () => {
    await mkdir(join(base, "dotfiles", "aws"), { recursive: true });
    await symlink(join(base, "dotfiles", "aws"), join(home, ".aws"));
    expect(await classOf(join(base, "dotfiles", "aws", "credentials"))).toBe("denied");
  });

  it("denies system directories, including through the /etc link", async () => {
    expect(await classOf("/etc/hosts")).toBe("denied");
    expect(await classOf("/System/Library")).toBe("denied");
    expect(await classOf("/usr/bin/env")).toBe("denied");
  });

  it("does not treat a folder with a shared prefix as inside", async () => {
    await mkdir(join(home, "project-old"), { recursive: true });
    expect(await classOf(join(home, "project-old", "x"))).toBe("outside");
  });
});
