// Git through `run_program`, never a shell: one git command whose failure throws git's own words, a repository's default
// branch, worktrees made on their own branch, listed, reset and removed, and readers for what `git diff --raw` and
// `--numstat` print, so an app can list a branch's changed files with their status and line counts.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";

import type { DiffFileStatus } from "../diff_rows.ts";
import { run_program } from "./programs.ts";

// ── Running ──────────────────────────────────────────────────────────────────

// Runs git in a folder and gives back what it printed, throwing its last words when it ends with an exit code not allowed.
export async function git(args: string[], cwd: string, allowed_exit_codes: number[] = [0]): Promise<string> {
  const result = await run_program(["git", ...args], { cwd, stdout: "keep", stderr: "keep" });
  if (!allowed_exit_codes.includes(result.exit_code)) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || `exit ${result.exit_code}`}`);
  return result.stdout;
}

// The branch origin's HEAD names, such as "origin/main", or "HEAD" when the repository has no origin.
export async function default_branch(repository: string): Promise<string> {
  try {
    return (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repository)).trim();
  } catch {
    return "HEAD";
  }
}

// ── Worktrees ────────────────────────────────────────────────────────────────

export interface WorktreeRequest {
  // Where the worktree goes, such as `<repository>/.claude/worktrees/<name>`.
  path: string;
  branch: string;
  // What a new branch starts from; the default branch, freshly fetched, unless given.
  base?: string;
}

export interface Worktree {
  path: string;
  // The commit checked out, or "" for a worktree with no commit yet.
  head: string;
  // The branch without refs/heads/, or "" when detached.
  branch: string;
  // Whether it is the repository's main checkout.
  main: boolean;
}

// The worktree at the path, made the first time on its own branch, the branch taken when it already exists.
export async function add_worktree(repository: string, { path, branch, base }: WorktreeRequest): Promise<string> {
  if (existsSync(path)) return path;
  if (base === undefined) await git(["fetch", "--quiet", "origin"], repository).catch(() => undefined);
  const has_branch = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repository).then(
    () => true,
    () => false,
  );
  if (has_branch) await git(["worktree", "add", path, branch], repository);
  else await git(["worktree", "add", "-b", branch, path, base ?? (await default_branch(repository))], repository);
  return path;
}

// The repository's worktrees, its main checkout first, as `git worktree list --porcelain` names them.
export async function list_worktrees(repository: string): Promise<Worktree[]> {
  const text = await git(["worktree", "list", "--porcelain", "-z"], repository);
  const worktrees: Worktree[] = [];
  let current: Worktree | null = null;
  for (const field of text.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: field.slice("worktree ".length), head: "", branch: "", main: worktrees.length === 0 };
      worktrees.push(current);
    } else if (current && field.startsWith("HEAD ")) current.head = field.slice("HEAD ".length);
    else if (current && field.startsWith("branch ")) current.branch = field.slice("branch ".length).replace(/^refs\/heads\//, "");
  }
  return worktrees;
}

// Puts the worktree back to a commit, throwing away every change and new file since, ignored files kept.
export async function reset_worktree(path: string, commit: string): Promise<void> {
  await git(["reset", "--hard", commit], path);
  await git(["clean", "-fd"], path);
}

// Removes a worktree, even with changes in it when `force`, and its branch too when `delete_branch` and it is merged or forced.
export async function remove_worktree(repository: string, path: string, options: { force?: boolean; delete_branch?: string } = {}): Promise<void> {
  await git(["worktree", "remove", ...(options.force ? ["--force"] : []), path], repository);
  if (options.delete_branch) await git(["branch", options.force ? "-D" : "-d", options.delete_branch], repository);
}

// ── Reading changes ──────────────────────────────────────────────────────────

const status_letters: Record<string, DiffFileStatus> = { A: "added", D: "removed", R: "renamed", C: "added", M: "changed", T: "changed" };

export interface RawChange {
  path: string;
  old_path: string;
  status: DiffFileStatus;
  // The blob of the new side, all zeros when it is the worktree's own file.
  blob: string;
}

// `git diff --raw --no-abbrev -z` output read into changes; a rename or copy names its old path first.
export function read_raw_changes(text: string): RawChange[] {
  const parts = text.split("\0");
  const changes: RawChange[] = [];
  for (let index = 0; index < parts.length - 1; ) {
    const fields = parts[index]!.replace(/^:/, "").split(" ");
    const letter = fields[4]?.[0] ?? "M";
    const blob = fields[3] ?? "";
    if (letter === "R" || letter === "C") {
      changes.push({ old_path: parts[index + 1]!, path: parts[index + 2]!, status: status_letters[letter]!, blob });
      index += 3;
    } else {
      changes.push({ old_path: parts[index + 1]!, path: parts[index + 1]!, status: status_letters[letter] ?? "changed", blob });
      index += 2;
    }
  }
  return changes;
}

// `git diff --numstat -z` output as each path's added and removed lines, null for a binary file.
export function read_numstat(text: string): Map<string, { additions: number; deletions: number } | null> {
  const parts = text.split("\0");
  const counts = new Map<string, { additions: number; deletions: number } | null>();
  for (let index = 0; index < parts.length - 1; ) {
    const [added, removed, path] = parts[index]!.split("\t");
    const value = added === "-" ? null : { additions: Number(added) || 0, deletions: Number(removed) || 0 };
    // A rename leaves the path empty and names the old and new paths after it.
    if (path === "") {
      counts.set(parts[index + 2]!, value);
      index += 3;
    } else {
      counts.set(path!, value);
      index += 1;
    }
  }
  return counts;
}

// The lines plain `git diff --numstat` output counts as added and removed, binary files left out.
export function sum_numstat(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split("\n")) {
    const [added, removed] = line.split("\t");
    if (!added || added === "-") continue;
    additions += Number(added) || 0;
    deletions += Number(removed) || 0;
  }
  return { additions, deletions };
}

// Files git does not track yet and does not ignore, which a diff against a commit leaves out.
export async function untracked_files(worktree: string): Promise<string[]> {
  return (await git(["ls-files", "--others", "--exclude-standard", "-z"], worktree)).split("\0").filter(Boolean);
}
