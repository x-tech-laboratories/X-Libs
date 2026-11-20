// Reads a change for the change checks from git: the files changed since a base with the lines each added, the commits
// since it, package.json and vitest.config.ts before and after, and the licence each new dependency declares as installed.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { run_program } from "./agent/programs.ts";
import { new_dependencies, type Change, type ChangedFile, type Commit, type Manifest } from "./change_checks.ts";

// ── Git ──────────────────────────────────────────────────────────────────────

async function git(args: string[], folder: string): Promise<string> {
  const result = await run_program(["git", "-c", "core.quotePath=false", ...args], { cwd: folder, stdout: "keep", stderr: "keep" });
  if (result.exit_code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || `exit ${result.exit_code}`}`);
  return result.stdout;
}

// A file's text at a commit, or null where it does not exist there.
async function file_at(folder: string, commit: string, path: string): Promise<string | null> {
  return git(["show", `${commit}:${path}`], folder).catch(() => null);
}

function file_on_disk(folder: string, path: string): string | null {
  const full = join(folder, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// The owner/name of a GitHub remote's address over ssh or https, or "" for anything else.
export function repository_of_remote(url: string): string {
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? "";
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface ReadChangeOptions {
  // Whether uncommitted and untracked files count too, for a checkout being worked in; otherwise base..HEAD.
  working_tree?: boolean;
  // The repository as owner/name; read from the origin remote when left out.
  repository?: string;
}

const status_of: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "added", T: "modified" };

// Every file changed since the base, with the lines each added and its text after the change.
export async function read_changed_files(folder: string, base: string, working_tree = false): Promise<ChangedFile[]> {
  const range = working_tree ? [base] : [base, "HEAD"];
  const files = new Map<string, ChangedFile>();
  for (const line of (await git(["diff", "--no-ext-diff", "--name-status", "--find-renames", ...range], folder)).split("\n").filter(Boolean)) {
    const [code = "M", ...paths] = line.split("\t");
    const path = paths.at(-1)!;
    files.set(path, { path, status: status_of[code.charAt(0)] ?? "modified", added: [] });
  }

  let current: ChangedFile | undefined;
  let in_header = false;
  let next_line = 0;
  for (const line of (await git(["diff", "--no-ext-diff", "--unified=0", "--no-color", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/", ...range], folder)).split("\n")) {
    if (line.startsWith("diff --git ")) {
      in_header = true;
      current = undefined;
    } else if (in_header && line.startsWith("+++ ")) current = files.get(line.slice(6));
    else if (line.startsWith("@@")) {
      in_header = false;
      next_line = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (!in_header && line.startsWith("+") && current) current.added.push({ line: next_line++, text: line.slice(1) });
  }

  for (const file of files.values()) {
    if (file.status === "deleted") continue;
    const text = working_tree ? file_on_disk(folder, file.path) : await file_at(folder, "HEAD", file.path);
    if (text !== null) file.text = text;
  }
  if (working_tree) {
    for (const path of (await git(["ls-files", "--others", "--exclude-standard"], folder)).split("\n").filter(Boolean)) {
      const text = readFileSync(join(folder, path), "utf8");
      files.set(path, { path, status: "added", added: text.split("\n").map((each, index) => ({ line: index + 1, text: each })), text });
    }
  }
  return [...files.values()];
}

// The commits since the base, merges left out, oldest last as git lists them.
export async function read_commits(folder: string, base: string): Promise<Commit[]> {
  const log = await git(["log", "--no-merges", "--format=%H%x00%B%x1e", `${base}..HEAD`], folder);
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", message = ""] = entry.split("\x00");
      return { sha, message: message.trim() };
    });
}

// The licence a package installed in the folder declares, or null when it is not installed or does not say.
export function installed_licence(folder: string, name: string): string | null {
  const text = file_on_disk(folder, join("node_modules", name, "package.json"));
  if (text === null) return null;
  const licence = (JSON.parse(text) as { license?: unknown }).license;
  if (typeof licence === "string" && licence) return licence;
  if (licence && typeof licence === "object" && typeof (licence as { type?: unknown }).type === "string") return (licence as { type: string }).type;
  return null;
}

function parse_or_null(text: string | null): Manifest | null {
  try {
    return text === null ? null : (JSON.parse(text) as Manifest);
  } catch {
    return null;
  }
}

// The whole change since the base, as the change checks take it, with the base resolved to its commit.
export async function read_change(folder: string, base: string, options: ReadChangeOptions = {}): Promise<Change> {
  const working_tree = options.working_tree ?? false;
  const after = (path: string) => (working_tree ? Promise.resolve(file_on_disk(folder, path)) : file_at(folder, "HEAD", path));
  const package_json = { before: await file_at(folder, base, "package.json"), after: await after("package.json") };
  const added = new_dependencies(parse_or_null(package_json.before), parse_or_null(package_json.after));
  const repository = options.repository ?? repository_of_remote(await git(["remote", "get-url", "origin"], folder).catch(() => ""));
  return {
    repository,
    base: (await git(["rev-parse", "--verify", `${base}^{commit}`], folder)).trim(),
    files: await read_changed_files(folder, base, working_tree),
    commits: await read_commits(folder, base),
    package_json,
    vitest_config: { before: await file_at(folder, base, "vitest.config.ts"), after: await after("vitest.config.ts") },
    licences: Object.fromEntries(added.map((name) => [name, installed_licence(folder, name)])),
  };
}
