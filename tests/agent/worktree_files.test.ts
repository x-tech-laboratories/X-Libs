import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { confined_path, list_worktree_files, read_worktree_file } from "../../src/agent/worktree_files.ts";

// A throwaway checkout with a tracked file, a new one, an ignored one, node_modules, a binary file and three symlinks.
function checkout(): { folder: string; outside: string } {
  const folder = mkdtempSync(join(tmpdir(), "x-libs-files-"));
  const outside = mkdtempSync(join(tmpdir(), "x-libs-outside-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", ...args], { cwd: folder, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(folder, "src"));
  writeFileSync(join(folder, "src", "board.ts"), "export const lanes = 1;\n");
  writeFileSync(join(folder, ".gitignore"), "build/\n");
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");
  writeFileSync(join(folder, "notes.md"), "new\n");
  mkdirSync(join(folder, "build"));
  writeFileSync(join(folder, "build", "out.js"), "ignored\n");
  mkdirSync(join(folder, "node_modules"));
  writeFileSync(join(folder, "node_modules", "lib.js"), "left out\n");
  writeFileSync(join(folder, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 1, 2]));
  writeFileSync(join(outside, "secret.txt"), "outside\n");
  symlinkSync(join(outside, "secret.txt"), join(folder, "escape.txt"));
  symlinkSync("src/board.ts", join(folder, "board-link.ts"));
  symlinkSync("node_modules/lib.js", join(folder, "hidden-link.js"));
  return { folder, outside };
}

describe("a worktree's files", () => {
  it("are what git tracks or would track, ignored files, .git and node_modules left out, cut at a count", async () => {
    const { folder } = checkout();

    expect(await list_worktree_files(folder)).toEqual({ paths: [".gitignore", "board-link.ts", "escape.txt", "hidden-link.js", "logo.png", "notes.md", "src/board.ts"], truncated: false });
    expect(await list_worktree_files(folder, { most_files: 2 })).toEqual({ paths: [".gitignore", "board-link.ts"], truncated: true });
    expect((await list_worktree_files(folder, { skipped_folders: ["src"] })).paths).not.toContain("src/board.ts");
  });

  it("are read as text, a binary or too large one without its text, and a symlink inside the worktree followed", () => {
    const { folder } = checkout();

    expect(read_worktree_file(folder, "src/board.ts")).toEqual({ path: "src/board.ts", size: 24, symlink: false, text: "export const lanes = 1;\n", reason: "" });
    expect(read_worktree_file(folder, "logo.png")).toMatchObject({ text: null, reason: "binary" });
    expect(read_worktree_file(folder, "board-link.ts")).toMatchObject({ symlink: true, text: "export const lanes = 1;\n" });
    expect(read_worktree_file(folder, "notes.md", { most_bytes: 2 })).toMatchObject({ text: null, reason: "too_large" });
  });

  it("refuse a path that leads out of the worktree or into what is never shown", () => {
    const { folder, outside } = checkout();

    expect(() => read_worktree_file(folder, "../x")).toThrow("is not a path inside the worktree");
    expect(() => read_worktree_file(folder, join(outside, "secret.txt"))).toThrow("is not a path inside the worktree");
    expect(() => read_worktree_file(folder, "")).toThrow("is not a path inside the worktree");
    expect(() => read_worktree_file(folder, "escape.txt")).toThrow("leads out of the worktree");
    expect(() => read_worktree_file(folder, "hidden-link.js")).toThrow("leads into a folder that is not shown");
    expect(() => read_worktree_file(folder, ".git/config")).toThrow("is in a folder that is not shown");
    expect(() => read_worktree_file(folder, "node_modules\\lib.js")).toThrow("is in a folder that is not shown");
    expect(() => read_worktree_file(folder, "missing.ts")).toThrow("does not exist");
    expect(() => read_worktree_file(folder, "src")).toThrow("is not a file");
    expect(() => confined_path(folder, ".")).toThrow("leads out of the worktree");
  });
});
