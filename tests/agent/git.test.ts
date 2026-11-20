import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { add_worktree, default_branch, git, list_worktrees, read_numstat, read_raw_changes, remove_worktree, reset_worktree, sum_numstat, untracked_files } from "../../src/agent/git.ts";

const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.org"];

// A throwaway repository with one commit, and a clone of it whose origin is that repository.
function repositories(): { origin: string; clone: string } {
  const origin = realpathSync(mkdtempSync(join(tmpdir(), "x-libs-origin-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: origin });
  writeFileSync(join(origin, "README.md"), "# Test\n");
  execFileSync("git", ["add", "."], { cwd: origin });
  execFileSync("git", [...identity, "commit", "-q", "-m", "chore: start"], { cwd: origin });
  const clone = join(realpathSync(mkdtempSync(join(tmpdir(), "x-libs-clone-"))), "clone");
  execFileSync("git", ["clone", "-q", origin, clone]);
  return { origin, clone };
}

describe("git", () => {
  it("runs git and throws its own words on a failure", async () => {
    const { origin } = repositories();

    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], origin)).trim()).toBe("main");
    await expect(git(["checkout", "no-such-branch"], origin)).rejects.toThrow(/^git checkout failed: error: pathspec/);
    expect(await git(["diff", "--quiet", "--no-index", "README.md", "README.md"], origin, [0, 1])).toBe("");
  });

  it("names the default branch from origin, or HEAD without one", async () => {
    const { origin, clone } = repositories();

    expect(await default_branch(clone)).toBe("origin/main");
    expect(await default_branch(origin)).toBe("HEAD");
  });
});

describe("worktrees", () => {
  it("are made on their own branch once, listed, reset and removed with their branch", async () => {
    const { clone } = repositories();
    const path = join(clone, ".claude", "worktrees", "feature");

    expect(await add_worktree(clone, { path, branch: "worktree-feature" })).toBe(path);
    expect(await add_worktree(clone, { path, branch: "worktree-feature" })).toBe(path);
    const listed = await list_worktrees(clone);
    expect(listed.map((each) => [each.path, each.branch, each.main])).toEqual([
      [clone, "main", true],
      [path, "worktree-feature", false],
    ]);
    expect(listed[1]!.head).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(join(path, "README.md"), "changed\n");
    writeFileSync(join(path, "new.txt"), "new\n");
    expect(await untracked_files(path)).toEqual(["new.txt"]);
    await reset_worktree(path, listed[1]!.head);
    expect(existsSync(join(path, "new.txt"))).toBe(false);
    expect((await git(["status", "--porcelain"], path)).trim()).toBe("");

    await remove_worktree(clone, path, { delete_branch: "worktree-feature" });
    expect(existsSync(path)).toBe(false);
    expect((await git(["branch", "--list", "worktree-feature"], clone)).trim()).toBe("");
  });

  it("take a branch that already exists, or start from the base given, and are forced out with changes", async () => {
    const { origin } = repositories();
    await git(["branch", "kept"], origin);
    const first = join(origin, "trees", "kept");
    const second = join(origin, "trees", "fresh");

    await add_worktree(origin, { path: first, branch: "kept" });
    await add_worktree(origin, { path: second, branch: "fresh", base: "main" });
    writeFileSync(join(second, "README.md"), "dirty\n");

    await expect(remove_worktree(origin, second)).rejects.toThrow("git worktree failed");
    await remove_worktree(origin, second, { force: true, delete_branch: "fresh" });
    expect((await list_worktrees(origin)).map((each) => each.branch)).toEqual(["main", "kept"]);
  });
});

describe("git's lists of changes", () => {
  it("read raw changes, a rename naming its old path first", () => {
    const zeros = "0".repeat(40);
    const text = [`:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M`, "src/a.ts", `:100644 100644 ${"c".repeat(40)} ${"d".repeat(40)} R087`, "old.ts", "new.ts", `:000000 100644 ${zeros} ${zeros} A`, "fresh.ts", `:100644 000000 ${"e".repeat(40)} ${zeros} D`, "gone.ts", ""].join("\0");

    expect(read_raw_changes(text)).toEqual([
      { path: "src/a.ts", old_path: "src/a.ts", status: "changed", blob: "b".repeat(40) },
      { path: "new.ts", old_path: "old.ts", status: "renamed", blob: "d".repeat(40) },
      { path: "fresh.ts", old_path: "fresh.ts", status: "added", blob: zeros },
      { path: "gone.ts", old_path: "gone.ts", status: "removed", blob: zeros },
    ]);
  });

  it("read line counts by path, a binary file as null and a rename by its new path", () => {
    const text = ["3\t1\tsrc/a.ts", "-\t-\tlogo.png", "2\t0\t", "old.ts", "new.ts", ""].join("\0");

    expect(read_numstat(text)).toEqual(
      new Map([
        ["src/a.ts", { additions: 3, deletions: 1 }],
        ["logo.png", null],
        ["new.ts", { additions: 2, deletions: 0 }],
      ]),
    );
    expect(sum_numstat("3\t1\ta\n-\t-\tb\n\n2\t2\tc\n")).toEqual({ additions: 5, deletions: 3 });
  });
});
