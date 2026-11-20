import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { create_check_registry } from "../src/change_checks.ts";
import { default_checks, format_results, options_from_manifest, run_check_command } from "../src/change_checks_cli.ts";
import { installed_licence, read_change, read_changed_files, read_commits, repository_of_remote } from "../src/change_checks_git.ts";

// A repository with one commit holding a.ts, a package.json and a vitest config.
function make_repository(): { folder: string; base: string; git: (...args: string[]) => string } {
  const folder = mkdtempSync(join(tmpdir(), "x-libs-change-checks-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Example User", "-c", "user.email=user@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: folder, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(folder, "a.ts"), "const a = 1;\nconst b = 2;\n");
  writeFileSync(join(folder, "package.json"), JSON.stringify({ dependencies: {} }));
  writeFileSync(join(folder, "vitest.config.ts"), "thresholds: { lines: 80 }");
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");
  return { folder, base: git("rev-parse", "HEAD"), git };
}

function capture(): { write(text: string): void; text: () => string } {
  let written = "";
  return { write: (text) => void (written += text), text: () => written };
}

// ============================================================================
// Reading git
// ============================================================================

describe("reading a change from git", () => {
  it("lists the files committed since the base with the lines each added and its text after", async () => {
    const { folder, base, git } = make_repository();
    writeFileSync(join(folder, "a.ts"), "const a = 1;\nconsole.log(a);\n++ not a header\nconst b = 2;\n");
    writeFileSync(join(folder, "gone.ts"), "x\n");
    git("add", ".");
    git("commit", "-q", "-m", "feat: log a\n\nAssisted-by: Claude Code");
    writeFileSync(join(folder, "untracked.ts"), "debugger;\n");

    expect(await read_changed_files(folder, base)).toEqual([
      { path: "a.ts", status: "modified", added: [{ line: 2, text: "console.log(a);" }, { line: 3, text: "++ not a header" }], text: "const a = 1;\nconsole.log(a);\n++ not a header\nconst b = 2;\n" },
      { path: "gone.ts", status: "added", added: [{ line: 1, text: "x" }], text: "x\n" },
    ]);
    expect(await read_commits(folder, base)).toEqual([{ sha: git("rev-parse", "HEAD"), message: "feat: log a\n\nAssisted-by: Claude Code" }]);
  });

  it("counts uncommitted and untracked files in a working tree, and deleted files without text", async () => {
    const { folder, base, git } = make_repository();
    git("rm", "-q", "a.ts");
    mkdirSync(join(folder, "tests"));
    writeFileSync(join(folder, "tests", "a.test.ts"), "it('a', () => {});\n");

    expect(await read_changed_files(folder, base, true)).toEqual([
      { path: "a.ts", status: "deleted", added: [] },
      { path: "tests/a.test.ts", status: "added", added: [{ line: 1, text: "it('a', () => {});" }, { line: 2, text: "" }], text: "it('a', () => {});\n" },
    ]);
  });

  it("reads package.json, the vitest config and the licences of new dependencies", async () => {
    const { folder, base, git } = make_repository();
    writeFileSync(join(folder, "package.json"), JSON.stringify({ dependencies: { yaml: "^2", bare: "1", missing: "1" } }));
    for (const [name, manifest] of [["yaml", { license: "ISC" }], ["bare", { license: { type: "MIT" } }]] as const) {
      mkdirSync(join(folder, "node_modules", name), { recursive: true });
      writeFileSync(join(folder, "node_modules", name, "package.json"), JSON.stringify(manifest));
    }
    writeFileSync(join(folder, ".gitignore"), "node_modules\n");
    git("add", ".");
    git("commit", "-q", "-m", "build: add yaml");
    git("remote", "add", "origin", "git@github.com:x-tech-laboratories/X-Example.git");

    const change = await read_change(folder, base);
    expect(change.repository).toBe("x-tech-laboratories/X-Example");
    expect(change.licences).toEqual({ yaml: "ISC", bare: "MIT", missing: null });
    expect(change.vitest_config).toEqual({ before: "thresholds: { lines: 80 }", after: "thresholds: { lines: 80 }" });
    expect(change.package_json.before).toBe(JSON.stringify({ dependencies: {} }));
    expect((await read_change(folder, base, { repository: "someone/else", working_tree: true })).repository).toBe("someone/else");
    writeFileSync(join(folder, "node_modules", "bare", "package.json"), "{}");
    expect(installed_licence(folder, "bare")).toBeNull();
  });

  it("reads the repository from a GitHub remote over ssh or https", () => {
    expect(repository_of_remote("git@github.com:x-tech-laboratories/X-Dev.git")).toBe("x-tech-laboratories/X-Dev");
    expect(repository_of_remote("https://github.com/x-tech-laboratories/X-Dev\n")).toBe("x-tech-laboratories/X-Dev");
    expect(repository_of_remote("https://example.com/a/b")).toBe("");
  });

  it("says why when git refuses", async () => {
    const { folder } = make_repository();
    await expect(read_commits(folder, "no-such-ref")).rejects.toThrow(/git log failed/);
  });
});

// ============================================================================
// The command
// ============================================================================

describe("x-libs-check", () => {
  async function run(args: string[], folder: string, env: Record<string, string> = {}) {
    const out = capture();
    const err = capture();
    const code = await run_check_command(args, { cwd: folder, env, out, err });
    return { code, out: out.text(), err: err.text() };
  }

  it("fails on a failed check and prints each finding on its own line", async () => {
    const { folder, base, git } = make_repository();
    writeFileSync(join(folder, "b.ts"), "console.log(1);\n");
    git("add", ".");
    git("commit", "-q", "-m", "feat: b\n\nAssisted-by: Claude Code");

    const result = await run(["--base", base], folder, { GITHUB_REPOSITORY: "x-tech-laboratories/X-Example" });
    expect(result.code).toBe(1);
    expect(result.out).toContain("✗ leftovers: failed\n    b.ts:1 logs to the console\n");
    expect(result.out).toContain("✓ commits: passed");
    expect(result.out.split("\n").filter((line) => /^\S /.test(line)).length).toBe(default_checks.length);
  });

  it("passes when only the named checks pass, and reads settings from package.json at the base", async () => {
    const { folder, base, git } = make_repository();
    writeFileSync(join(folder, "package.json"), JSON.stringify({ "x-libs-check": { commit_trailer: "Signed-off-by", trailer_organisations: ["acme"] } }));
    git("add", ".");
    git("commit", "-q", "-m", "chore: settings\n\nSigned-off-by: Example User");
    const settled = git("rev-parse", "HEAD");
    writeFileSync(join(folder, "c.ts"), "const c = 3;\n");
    git("add", ".");
    git("commit", "-q", "-m", "feat: c\n\nSigned-off-by: Example User");

    expect((await run(["--base", settled, "--repository", "acme/tool", "commits", "leftovers"], folder)).code).toBe(0);
    expect((await run(["--base", base, "--repository", "x-tech-laboratories/tool", "commits"], folder)).out).toContain("has no Assisted-by trailer");
  });

  it("refuses unknown checks and options, explains itself and reports a bad base", async () => {
    const { folder } = make_repository();
    expect((await run(["vibes"], folder)).err).toContain("no check called vibes");
    expect((await run(["--nope"], folder)).code).toBe(2);
    expect((await run(["--help"], folder)).out).toContain("Usage: x-libs-check");
    const missing_base = await run(["--base", "no-such-ref"], folder);
    expect(missing_base.code).toBe(2);
    expect(missing_base.err).toContain("x-libs-check:");
  });

  it("runs an app's own registry", async () => {
    const { folder, base } = make_repository();
    const registry = create_check_registry();
    registry.add("firmware", () => ({ gate: "firmware", outcome: "warning", findings: ["the build is large"] }));
    const out = capture();
    const code = await run_check_command(["--base", base, "firmware"], { cwd: folder, env: {}, out, err: capture(), registry });
    expect(code).toBe(0);
    expect(out.text()).toBe("! firmware: warning\n    the build is large\n");
  });

  it("keeps only known settings of the right kind", () => {
    expect(options_from_manifest(null)).toEqual({});
    expect(options_from_manifest("{}")).toEqual({});
    expect(options_from_manifest(JSON.stringify({ "x-libs-check": { commit_trailer: null, ai_mention: "robot", allowed_licences: ["MIT"], wrapped_libraries: [1], other: true } }))).toEqual({ commit_trailer: null, ai_mention: /robot/i, allowed_licences: ["MIT"] });
    expect(options_from_manifest(JSON.stringify({ "x-libs-check": { ai_mention: null } }))).toEqual({ ai_mention: null });
  });

  it("marks each outcome", () => {
    expect(format_results([{ gate: "a", outcome: "skipped", findings: ["why"] }])).toBe("- a: skipped\n    why");
  });

  it("runs as a program", () => {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "..", "src", "change_checks_cli.ts"), "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Checks: commits, secrets");
  });
});
