// A git worktree's files for a page to browse read-only: every file git tracks or would track there, and one file's
// text, never inside a skipped folder such as .git or node_modules, and never by a path that leads out of the worktree
// through "..", an absolute path or a symlink; a binary or too large file comes back without its text.

// ── Imports ──────────────────────────────────────────────────────────────────

import { closeSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import { git } from "./git.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface WorktreeFiles {
  paths: string[];
  // Whether there were more files than are listed.
  truncated: boolean;
}

export interface WorktreeFile {
  path: string;
  size: number;
  // Whether the path is a symlink to another file inside the worktree.
  symlink: boolean;
  // Null when the file is not shown, as reason says.
  text: string | null;
  reason: "" | "binary" | "too_large";
}

export interface WorktreeFileLimits {
  // The most files listed, so a huge checkout does not swamp the page.
  most_files?: number;
  // The most bytes of one file shown.
  most_bytes?: number;
  // Folders never listed or read, wherever they are.
  skipped_folders?: readonly string[];
}

export const default_worktree_file_limits: Required<WorktreeFileLimits> = { most_files: 20_000, most_bytes: 1_000_000, skipped_folders: [".git", "node_modules"] };

// How much of a file is looked at to tell text from binary.
const sniff_bytes = 8_000;

function limits_of(limits: WorktreeFileLimits): Required<WorktreeFileLimits> {
  return { ...default_worktree_file_limits, ...limits };
}

function is_skipped(path: string, skipped_folders: readonly string[]): boolean {
  return path.split("/").some((part) => skipped_folders.includes(part));
}

// ── Listing ──────────────────────────────────────────────────────────────────

// The worktree's files, tracked and new alike, ignored ones left out, by path.
export async function list_worktree_files(worktree: string, limits: WorktreeFileLimits = {}): Promise<WorktreeFiles> {
  const { most_files, skipped_folders } = limits_of(limits);
  const text = await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], worktree);
  const paths = [...new Set(text.split("\0").filter((path) => path && !is_skipped(path, skipped_folders)))].sort((first, second) => first.localeCompare(second));
  return { paths: paths.slice(0, most_files), truncated: paths.length > most_files };
}

// ── Reading ──────────────────────────────────────────────────────────────────

// The file's real place on disk, refused when the path leads out of the worktree or into a skipped folder.
export function confined_path(worktree: string, path: string, limits: WorktreeFileLimits = {}): string {
  const { skipped_folders } = limits_of(limits);
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`${path} is not a path inside the worktree`);
  if (is_skipped(path.replaceAll("\\", "/"), skipped_folders)) throw new Error(`${path} is in a folder that is not shown`);
  let real: string;
  try {
    real = realpathSync(join(worktree, path));
  } catch {
    throw new Error(`${path} does not exist in the worktree`);
  }
  const inside = relative(realpathSync(worktree), real);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`${path} leads out of the worktree`);
  if (is_skipped(inside.split(sep).join("/"), skipped_folders)) throw new Error(`${path} leads into a folder that is not shown`);
  return real;
}

// One file's text, or why it is not shown: binary or too large; refused when it is not a file.
export function read_worktree_file(worktree: string, path: string, limits: WorktreeFileLimits = {}): WorktreeFile {
  const { most_bytes } = limits_of(limits);
  const real = confined_path(worktree, path, limits);
  const link = lstatSync(join(worktree, path));
  const stats = statSync(real);
  if (!stats.isFile()) throw new Error(`${path} is not a file`);
  const base = { path, size: stats.size, symlink: link.isSymbolicLink() };
  if (stats.size > most_bytes) return { ...base, text: null, reason: "too_large" };
  const handle = openSync(real, "r");
  try {
    const buffer = Buffer.alloc(stats.size);
    readSync(handle, buffer, 0, stats.size, 0);
    if (buffer.subarray(0, sniff_bytes).includes(0)) return { ...base, text: null, reason: "binary" };
    return { ...base, text: buffer.toString("utf8"), reason: "" };
  } finally {
    closeSync(handle);
  }
}
