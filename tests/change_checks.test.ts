import { describe, expect, it } from "vitest";

import {
  check_comments,
  check_commits,
  check_coverage,
  check_dependencies,
  check_leftovers,
  check_secrets,
  check_x_libs,
  code_only,
  create_check_registry,
  is_wrapping_repository,
  licence_allowed,
  needs_trailer,
  new_dependencies,
  read_thresholds,
  secret_kind,
  type Change,
  type ChangedFile,
} from "../src/change_checks.ts";

function changed(path: string, lines: string[], status: ChangedFile["status"] = "modified", first_line = 1): ChangedFile {
  return { path, status, added: lines.map((text, index) => ({ line: first_line + index, text })) };
}

function change_of(parts: Partial<Change> = {}): Change {
  return { repository: "", files: [], commits: [], package_json: { before: null, after: null }, vitest_config: { before: null, after: null }, licences: {}, ...parts };
}

// Made from pieces so no whole key or token sits in this file.
const token = ["gh", "p_", "x".repeat(36)].join("");
const key_header = ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ");

// ============================================================================
// Commits
// ============================================================================

describe("the commits check", () => {
  const good = { sha: "a".repeat(40), message: "feat(board): add swimlanes\n\nAssisted-by: Claude Code" };

  it("wants Conventional Commits, the trailer where it is needed and no AI mention elsewhere", () => {
    expect(check_commits([good], true).outcome).toBe("passed");
    expect(check_commits([{ sha: "b".repeat(40), message: "Added swimlanes" }], true).findings).toEqual(['bbbbbbb "Added swimlanes" is not a Conventional Commit', "bbbbbbb has no Assisted-by trailer"]);
    expect(check_commits([good], false).findings).toEqual(["aaaaaaa has an Assisted-by trailer, which only x-tech-laboratories repositories carry"]);
    expect(check_commits([{ sha: "c".repeat(40), message: "fix: lanes\n\nCo-Authored-By: Claude" }], false).findings).toEqual(["ccccccc mentions AI outside the trailer"]);
  });

  it("takes another trailer and organisation, or no rules at all", () => {
    const options = { commit_trailer: "Signed-off-by", trailer_organisations: ["acme"], ai_mention: null };
    expect(needs_trailer("Acme/tool", options)).toBe(true);
    expect(needs_trailer("x-tech-laboratories/X-Libs")).toBe(true);
    expect(needs_trailer("someone/else")).toBe(false);
    expect(check_commits([{ sha: "d".repeat(40), message: "fix: a\n\nSigned-off-by: Example User" }], true, options).outcome).toBe("passed");
    expect(check_commits([{ sha: "e".repeat(40), message: "fix: by Claude" }], false, { commit_trailer: null, ai_mention: null }).outcome).toBe("passed");
    expect(needs_trailer("x-tech-laboratories/X-Libs", { commit_trailer: null })).toBe(false);
  });
});

// ============================================================================
// Secrets
// ============================================================================

describe("the secrets check", () => {
  it("finds keys and tokens in added lines, environment files, commit messages and other texts", () => {
    const files = [changed("src/a.ts", [`const token = "${token}";`]), changed(".env", ["NAME=value"], "added"), changed(".env.example", ["NAME="], "added")];
    const commits = [{ sha: "f".repeat(40), message: `fix: rotate ${token}` }];
    expect(check_secrets(files, [{ name: "report", text: key_header }], commits).findings).toEqual([
      "src/a.ts:1 holds a GitHub token",
      ".env is an environment file, which keeps secrets",
      "fffffff's message holds a GitHub token",
      "the report holds a private key",
    ]);
    expect(check_secrets([changed("src/a.ts", ['const label = "Password";'])]).outcome).toBe("passed");
  });

  it("names only the kind of secret, never its value", () => {
    const result = check_secrets([changed("src/a.ts", [`const token = "${token}";`])]);
    expect(result.findings.join("\n")).not.toContain(token);
    expect(secret_kind(["AKIA", "A".repeat(16)].join(""))).toBe("an AWS key");
    expect(secret_kind("nothing here")).toBeNull();
  });
});

// ============================================================================
// Leftovers and comments
// ============================================================================

describe("the leftovers check", () => {
  it("finds debug output, commented-out code and TODOs without an issue in code", () => {
    const files = [changed("src/a.ts", ["console.log(lanes);", "// const old = 1;", "// TODO tidy this", "// TODO tidy this, #12", "debugger;"]), changed("README.md", ["console.log in docs is fine"]), changed("tests/fixtures/a.ts", ["debugger;"])];
    expect(check_leftovers(files).findings).toEqual(["src/a.ts:1 logs to the console", "src/a.ts:2 leaves code commented out", "src/a.ts:3 leaves a TODO without an issue", "src/a.ts:5 stops in the debugger"]);
  });
});

describe("code without its strings", () => {
  it("blanks strings and regular expressions, so checks read only the code around them", () => {
    expect(code_only('const pattern = /\\bdebugger\\b/; log("TODO later");')).toBe('const pattern = /./; log("");');
    expect(code_only("const half = total / 2 / count;")).toBe("const half = total / 2 / count;");
    expect(check_leftovers([changed("src/a.ts", ['[/\\bdebugger\\b/, "stops in the debugger"],', 'const note = "TODO";'])]).outcome).toBe("passed");
  });
});

describe("the comments check", () => {
  it("lets a file's overview start after a #! line, even one the change left alone", () => {
    expect(check_comments([changed("src/cli.ts", ["#!/usr/bin/env node", "// The overview,", "// at length."])]).outcome).toBe("passed");
    expect(check_comments([{ ...changed("src/cli.ts", ["// The overview,", "// at length."], "modified", 2), text: "#!/usr/bin/env node\n// The overview,\n// at length.\n" }]).outcome).toBe("passed");
  });

  it("fails a comment of more than one line, but not banners, the file's opening comment or separate one-liners", () => {
    const file = changed("src/a.ts", ["// The file's overview,", "// which may run long.", "", "// ── Lanes ──────", "// One line.", "const a = 1;", "// Two lines", "// in a row.", "/* a block"]);
    expect(check_comments([file, changed("docs/a.md", ["# One", "# Two"])]).findings).toEqual(["src/a.ts:7 has a comment 2 lines long", "src/a.ts:9 opens a block comment"]);
  });
});

// ============================================================================
// X-Libs, coverage and dependencies
// ============================================================================

describe("the x-libs check", () => {
  it("fails an app's import of a library X-Libs wraps, but not X-Libs' own", () => {
    const files = [changed("src/a.ts", ['import { eq } from "drizzle-orm";', 'import { Editor } from "@tiptap/react";', 'import { x } from "@x-tech-laboratories/x-libs/drizzle";', 'const m = await import("marked/lib");'])];
    expect(check_x_libs(files, false).findings).toEqual([
      "src/a.ts:1 imports drizzle-orm, which X-Libs wraps; import it from X-Libs",
      "src/a.ts:2 imports @tiptap/react, which X-Libs wraps; import it from X-Libs",
      "src/a.ts:4 imports marked/lib, which X-Libs wraps; import it from X-Libs",
    ]);
    expect(check_x_libs(files, true).outcome).toBe("passed");
    expect(check_x_libs(files, false, { wrapped_libraries: ["left-pad"] }).outcome).toBe("passed");
  });

  it("knows the wrapping repository whatever its case", () => {
    expect(is_wrapping_repository("X-Tech-Laboratories/x-libs")).toBe(true);
    expect(is_wrapping_repository("someone/X-Libs")).toBe(false);
  });
});

describe("the coverage check", () => {
  const config = (lines: number, exclude = "") => `coverage: { ${exclude}thresholds: { lines: ${lines}, statements: 50, functions: 50, branches: 50 } }`;

  it("reads the floor and fails one lowered or code newly left out", () => {
    expect(read_thresholds(config(60))).toEqual({ lines: 60, statements: 50, functions: 50, branches: 50 });
    expect(check_coverage(config(60), config(65)).outcome).toBe("passed");
    expect(check_coverage(config(60), config(55)).findings).toEqual(["the lines floor went from 60 to 55"]);
    expect(check_coverage(config(60), "coverage: {}").findings).toContain("the lines floor went from 60 to nothing");
    expect(check_coverage(config(60), config(60, 'exclude: ["src/daemon/**"], ')).findings).toEqual(['"src/daemon/**" was newly left out of coverage']);
    expect(check_coverage(config(60), null).findings).toEqual(["vitest.config.ts was deleted"]);
    expect(check_coverage(null, config(60)).outcome).toBe("passed");
    expect(check_coverage(null, null).outcome).toBe("skipped");
  });
});

describe("the dependencies check", () => {
  const licences: Record<string, string> = { yaml: "ISC", shady: "SSPL-1.0", dual: "(MIT OR GPL-2.0-only)", odd: "SEE LICENSE IN LICENSE.md" };
  const licence_of = (name: string) => licences[name] ?? null;

  it("names new dependencies with their licences, failing one whose licence is not allowed", () => {
    expect(check_dependencies({ dependencies: {} }, { dependencies: { yaml: "^2" } }, licence_of)).toEqual({ gate: "dependencies", outcome: "warning", findings: ["yaml is new, licensed ISC"] });
    expect(check_dependencies({}, { devDependencies: { shady: "1", yaml: "2" } }, licence_of).findings).toEqual(["shady is new, licensed SSPL-1.0, which is not among the allowed licences"]);
    expect(check_dependencies({ dependencies: { yaml: "^2" } }, { dependencies: { yaml: "^2.1" } }, () => null).outcome).toBe("passed");
    expect(check_dependencies(null, { dependencies: { unknown: "1" } }, licence_of).findings).toEqual(["unknown is new, licensed as it does not say"]);
  });

  it("reads SPDX expressions, and takes a licence written exactly as allowed", () => {
    expect(licence_allowed("(MIT OR GPL-2.0-only)", ["MIT"])).toBe(true);
    expect(licence_allowed("MIT AND SSPL-1.0", ["MIT"])).toBe(false);
    expect(licence_allowed("GPL-2.0-only", ["GPL-3.0-or-later"])).toBe(false);
    expect(licence_allowed("SEE LICENSE IN LICENSE.md", ["MIT"])).toBe(false);
    expect(check_dependencies(null, { dependencies: { odd: "1", dual: "1" } }, licence_of, { allowed_licences: ["MIT", "SEE LICENSE IN LICENSE.md"] }).outcome).toBe("warning");
  });

  it("lists only the names new to either kind of dependency", () => {
    expect(new_dependencies({ dependencies: { a: "1" } }, { dependencies: { a: "1", b: "1" }, devDependencies: { c: "1" } })).toEqual(["b", "c"]);
    expect(new_dependencies(null, null)).toEqual([]);
  });
});

// ============================================================================
// Registry
// ============================================================================

describe("the check registry", () => {
  it("runs the built-in checks on a described change by name", async () => {
    const change = change_of({
      repository: "x-tech-laboratories/X-Fitness",
      files: [changed("src/a.ts", ['import { eq } from "drizzle-orm";', "console.log(eq);"])],
      commits: [{ sha: "a".repeat(40), message: "feat: a" }],
      package_json: { before: '{"dependencies":{}}', after: '{"dependencies":{"yaml":"^2"}}' },
      vitest_config: { before: "lines: 80", after: "lines: 70" },
      licences: { yaml: "ISC" },
    });
    const registry = create_check_registry();
    const results = await registry.run(["commits", "secrets", "leftovers", "comments", "coverage", "x-libs", "dependencies"], change);
    expect(results.map((result) => [result.gate, result.outcome])).toEqual([
      ["commits", "failed"],
      ["secrets", "passed"],
      ["leftovers", "failed"],
      ["comments", "passed"],
      ["coverage", "failed"],
      ["x-libs", "failed"],
      ["dependencies", "warning"],
    ]);
    expect(results[0]!.findings).toEqual(["aaaaaaa has no Assisted-by trailer"]);
  });

  it("takes an app's own checks, skips unknown names and fails a check that throws", async () => {
    const registry = create_check_registry();
    registry.add("firmware", () => ({ gate: "anything", outcome: "passed", findings: [] }));
    registry.add("broken", () => {
      throw new Error("no compiler");
    });
    expect(registry.has("firmware")).toBe(true);
    expect(registry.names()).toContain("dependencies");
    expect(await registry.run(["firmware", "broken", "vibes"], change_of())).toEqual([
      { gate: "firmware", outcome: "passed", findings: [] },
      { gate: "broken", outcome: "failed", findings: ["the check could not run: no compiler"] },
      { gate: "vibes", outcome: "skipped", findings: ["there is no check called vibes"] },
    ]);
  });

  it("fails the dependencies check on a package.json that is not JSON", async () => {
    const [result] = await create_check_registry().run(["dependencies"], change_of({ package_json: { before: null, after: "{" } }));
    expect(result!.outcome).toBe("failed");
  });
});
