// Checks on a change, such as a pull request, that any repository's CI can run: its commit messages, secrets, debug
// leftovers and long comments in the lines it added, its coverage floor, imports of libraries X-App wraps, and the
// licences of new dependencies. Each check works on a change already described, so it runs anywhere and its tests need
// no repository; `change_checks_git` reads a change from git and `x-app-check` runs the checks from a CI job.

// ── Imports ──────────────────────────────────────────────────────────────────

import satisfies from "spdx-satisfies";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type GateOutcome = "passed" | "failed" | "warning" | "skipped";

export interface GateResult {
  // The check's name, such as "secrets".
  gate: string;
  outcome: GateOutcome;
  // What it found, one line each, such as "src/a.ts:12 logs to the console".
  findings: string[];
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  // The lines the change added, each with its line number in the new file.
  added: { line: number; text: string }[];
  // The whole file after the change; left out for a deleted file.
  text?: string;
}

export interface Commit {
  sha: string;
  message: string;
}

// A file's text before and after the change, null where it does not exist.
export interface BeforeAndAfter {
  before: string | null;
  after: string | null;
}

export interface Change {
  // The repository as owner/name, such as "x-tech-laboratories/X-App", or "" when it is not known.
  repository: string;
  // The commit the change is measured from, as read_change resolved it.
  base?: string;
  files: ChangedFile[];
  commits: Commit[];
  package_json: BeforeAndAfter;
  vitest_config: BeforeAndAfter;
  // The licence each new dependency declares as installed, null where it does not say.
  licences: Record<string, string | null>;
  // Other text the change hands on, such as a run's report, searched for secrets too.
  texts?: { name: string; text: string }[];
}

export interface ChangeCheckOptions {
  // The trailer every commit carries in the organisations below and no other commit carries; null for no rule.
  commit_trailer: string | null;
  trailer_organisations: string[];
  // What a commit message may not say outside its trailer; null for no rule.
  ai_mention: RegExp | null;
  // Packages X-App wraps, which an app imports through X-App; a name ending in "/" covers a whole scope.
  wrapped_libraries: string[];
  // Repositories, as owner/name, that wrap those packages and so may import them.
  wrapping_repositories: string[];
  // SPDX licences a new dependency may have, or a package's licence text exactly as it writes it.
  allowed_licences: string[];
}

// ── Defaults ─────────────────────────────────────────────────────────────────

// X-Tech Laboratories' rules: the Assisted-by trailer, X-App's wrapped libraries, and licences GPL-3.0-or-later can take in.
export const x_tech_options: ChangeCheckOptions = {
  commit_trailer: "Assisted-by",
  trailer_organisations: ["x-tech-laboratories"],
  ai_mention: /\b(claude|anthropic|co-authored-by|generated with|ai[- ]generated|chatgpt|copilot)\b/i,
  wrapped_libraries: ["drizzle-orm", "@tanstack/react-table", "lucide-react", "marked", "dompurify", "@tiptap/", "fflate", "rrule", "frimousse", "squarify", "react-error-boundary", "es-module-lexer", "hookable", "parse-duration", "pretty-bytes", "emojibase", "emojibase-data", "@sqlite.org/sqlite-wasm", "@modelcontextprotocol/server", "@fastify/session", "nodemailer", "sshpk"],
  wrapping_repositories: ["x-tech-laboratories/X-App"],
  allowed_licences: ["0BSD", "MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "Zlib", "Unlicense", "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "BlueOak-1.0.0", "Python-2.0", "Artistic-2.0", "MPL-2.0", "LGPL-2.1-or-later", "LGPL-3.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later"],
};

function options_with_defaults(options: Partial<ChangeCheckOptions>): ChangeCheckOptions {
  return { ...x_tech_options, ...options };
}

// ── Results ──────────────────────────────────────────────────────────────────

export function passed(gate: string): GateResult {
  return { gate, outcome: "passed", findings: [] };
}

export function skipped(gate: string, why: string): GateResult {
  return { gate, outcome: "skipped", findings: [why] };
}

function verdict(gate: string, findings: string[], outcome: "failed" | "warning" = "failed"): GateResult {
  return findings.length ? { gate, outcome, findings } : passed(gate);
}

// ── Code only ────────────────────────────────────────────────────────────────

const string_literal = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const regex_literal = /(^|[(,=:[!&|?{};])(\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[dgimsuvy]*/g;

// A line of code with its strings and regular expressions blanked, so a check reads only the code around them.
export function code_only(line: string): string {
  return line.replace(string_literal, '""').replace(regex_literal, "$1$2/./");
}

export const code_file = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|nix|sh)$/;

// ── Commits ──────────────────────────────────────────────────────────────────

const conventional = /^(feat|fix|build|chore|ci|docs|style|refactor|perf|test|revert)(\([^)]+\))?!?: \S/;

function escape_pattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whether the repository's commits carry the trailer, by the organisation that owns it.
export function needs_trailer(repository: string, options: Partial<ChangeCheckOptions> = {}): boolean {
  const { commit_trailer, trailer_organisations } = options_with_defaults(options);
  const owner = repository.split("/")[0]!.toLowerCase();
  return commit_trailer !== null && trailer_organisations.some((organisation) => organisation.toLowerCase() === owner);
}

// Conventional Commits; the trailer where it is needed and nowhere else, and no AI mention outside it.
export function check_commits(commits: readonly Commit[], trailer_needed: boolean, options: Partial<ChangeCheckOptions> = {}): GateResult {
  const { commit_trailer, trailer_organisations, ai_mention } = options_with_defaults(options);
  const trailer = commit_trailer === null ? null : new RegExp(`^${escape_pattern(commit_trailer)}: .+$`, "m");
  const findings: string[] = [];
  for (const commit of commits) {
    const [subject = ""] = commit.message.split("\n");
    const short = commit.sha.slice(0, 7);
    // A subject that holds a secret is left out of the finding, so the log never repeats it.
    if (!conventional.test(subject)) findings.push(secret_kind(subject) ? `${short}'s subject is not a Conventional Commit` : `${short} "${subject}" is not a Conventional Commit`);
    if (trailer && trailer_needed && !trailer.test(commit.message)) findings.push(`${short} has no ${commit_trailer} trailer`);
    if (trailer && !trailer_needed && trailer.test(commit.message)) findings.push(`${short} has an ${commit_trailer} trailer, which only ${trailer_organisations.join(" and ")} repositories carry`);
    const without_trailer = trailer ? commit.message.replace(new RegExp(trailer.source, "gm"), "") : commit.message;
    if (ai_mention?.test(without_trailer)) findings.push(`${short} mentions AI outside the trailer`);
  }
  return verdict("commits", findings);
}

// ── Secrets ──────────────────────────────────────────────────────────────────

// The private key header is put together so no whole one sits in this file.
const secret_patterns: [RegExp, string][] = [
  [new RegExp(`-----BEGIN [A-Z ]*${"PRIVATE"} KEY-----`), "a private key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "a GitHub token"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/\bsk-[A-Za-z0-9]{32,}\b/, "an API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS key"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\b(?:password|passwd|secret|api_key|apikey|token)\s*[:=]\s*["'](?![^"']*\$\{)[^"'\s]{8,}["']/i, "a password or token in the code"],
];

// What kind of secret a text holds, never the secret itself, or null.
export function secret_kind(text: string): string | null {
  return secret_patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

// Keys, tokens and private keys in added lines, commit messages and other texts, and added .env files; never the value.
export function check_secrets(files: readonly ChangedFile[], texts: readonly { name: string; text: string }[] = [], commits: readonly Commit[] = []): GateResult {
  const findings: string[] = [];
  for (const file of files) {
    if (/(^|\/)\.env(\.|$)/.test(file.path) && file.status !== "deleted" && !file.path.endsWith(".example")) findings.push(`${file.path} is an environment file, which keeps secrets`);
    for (const added of file.added) {
      const kind = secret_kind(added.text);
      if (kind) findings.push(`${file.path}:${added.line} holds ${kind}`);
    }
  }
  for (const commit of commits) {
    const kind = secret_kind(commit.message);
    if (kind) findings.push(`${commit.sha.slice(0, 7)}'s message holds ${kind}`);
  }
  for (const text of texts) {
    const kind = secret_kind(text.text);
    if (kind) findings.push(`the ${text.name} holds ${kind}`);
  }
  return verdict("secrets", findings);
}

// ── Leftovers ────────────────────────────────────────────────────────────────

const leftover_patterns: [RegExp, string][] = [
  [/\bconsole\.(?:log|debug)\(/, "logs to the console"],
  [/\bdebugger\b/, "stops in the debugger"],
  [/\b(?:TODO|FIXME|XXX)\b(?!.*#\d+)/, "leaves a TODO without an issue"],
  [/^\s*\/\/\s*(?:const|let|var|if|for|return|import|function)\b.*[;{)]\s*$/, "leaves code commented out"],
];

// Debug output, commented-out code and TODOs without an issue in the code lines a change added.
export function check_leftovers(files: readonly ChangedFile[]): GateResult {
  const findings: string[] = [];
  for (const file of files.filter((each) => code_file.test(each.path) && !each.path.startsWith("tests/fixtures/"))) {
    for (const added of file.added) {
      const code = code_only(added.text);
      for (const [pattern, what] of leftover_patterns) if (pattern.test(code)) findings.push(`${file.path}:${added.line} ${what}`);
    }
  }
  return verdict("leftovers", findings);
}

// ── Comments ─────────────────────────────────────────────────────────────────

const line_comment = /^\s*(?:\/\/|#)(?!\s*[─=#-]{2,})(?!!)/;

// The first and last line of a file's opening overview comment, after any #! line; last is before first when there is none.
export function overview_lines(file: ChangedFile): { first: number; last: number } {
  const added = new Map(file.added.map((each) => [each.line, each.text]));
  const lines = file.text?.split("\n");
  const line_at = (number: number) => added.get(number) ?? lines?.[number - 1] ?? "";
  const first = line_at(1).startsWith("#!") ? 2 : 1;
  let last = first - 1;
  while (line_comment.test(line_at(last + 1))) last += 1;
  return { first, last };
}

// Comments of more than one line in what a change added; each is one plain line, but for a file's opening overview.
export function check_comments(files: readonly ChangedFile[]): GateResult {
  const findings: string[] = [];
  for (const file of files.filter((each) => code_file.test(each.path))) {
    const overview = overview_lines(file);
    let run_start: number | null = null;
    let run_length = 0;
    let last_line = -1;
    const close = () => {
      if (run_start !== null && run_length > 1) findings.push(`${file.path}:${run_start} has a comment ${run_length} lines long`);
      run_start = null;
      run_length = 0;
    };
    for (const added of file.added) {
      const in_overview = added.line >= overview.first && added.line <= overview.last;
      const is_comment = !in_overview && line_comment.test(added.text);
      if (is_comment && run_start !== null && added.line === last_line + 1) run_length += 1;
      else {
        close();
        if (is_comment) {
          run_start = added.line;
          run_length = 1;
        }
      }
      last_line = added.line;
    }
    close();
    for (const added of file.added) if (/^\s*\/\*(?!.*\*\/)/.test(added.text)) findings.push(`${file.path}:${added.line} opens a block comment`);
  }
  return verdict("comments", findings);
}

// ── X-App ────────────────────────────────────────────────────────────────────

const import_from = /^\s*(?:import|export)\b[^"'`]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']/;

// Whether the repository is one that wraps the libraries, so its own imports of them are allowed.
export function is_wrapping_repository(repository: string, options: Partial<ChangeCheckOptions> = {}): boolean {
  return options_with_defaults(options).wrapping_repositories.some((each) => each.toLowerCase() === repository.toLowerCase());
}

// Imports of a library X-App wraps, which an app reaches through X-App instead.
export function check_x_app(files: readonly ChangedFile[], is_wrapping: boolean, options: Partial<ChangeCheckOptions> = {}): GateResult {
  if (is_wrapping) return passed("x-app");
  const { wrapped_libraries } = options_with_defaults(options);
  const findings: string[] = [];
  for (const file of files) {
    for (const added of file.added) {
      const match = import_from.exec(added.text);
      const source = match?.[1] ?? match?.[2] ?? match?.[3];
      const wrapped = source && wrapped_libraries.find((library) => (library.endsWith("/") ? source.startsWith(library) : source === library || source.startsWith(`${library}/`)));
      if (wrapped) findings.push(`${file.path}:${added.line} imports ${source}, which X-App wraps; import it from X-App`);
    }
  }
  return verdict("x-app", findings);
}

// ── Coverage ─────────────────────────────────────────────────────────────────

const threshold_keys = ["lines", "statements", "functions", "branches"];

// The coverage floor's numbers in a vitest config's text.
export function read_thresholds(config: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const key of threshold_keys) {
    const value = new RegExp(`\\b${key}\\s*:\\s*(\\d+(?:\\.\\d+)?)`).exec(config)?.[1];
    if (value !== undefined) found[key] = Number(value);
  }
  return found;
}

function coverage_excludes(config: string): string[] {
  const list = /coverage\s*:\s*\{[\s\S]*?\bexclude\s*:\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
  return list
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// A coverage floor lowered, or code newly left out of coverage, between the vitest config before and after.
export function check_coverage(before: string | null, after: string | null): GateResult {
  if (after === null) return before === null ? skipped("coverage", "the repository has no vitest.config.ts") : { gate: "coverage", outcome: "failed", findings: ["vitest.config.ts was deleted"] };
  if (before === null) return passed("coverage");
  const old_floor = read_thresholds(before);
  const new_floor = read_thresholds(after);
  const findings = threshold_keys.filter((key) => old_floor[key] !== undefined && (new_floor[key] ?? 0) < old_floor[key]!).map((key) => `the ${key} floor went from ${old_floor[key]} to ${new_floor[key] ?? "nothing"}`);
  const old_excludes = coverage_excludes(before);
  for (const entry of coverage_excludes(after).filter((each) => !old_excludes.includes(each))) findings.push(`${entry} was newly left out of coverage`);
  return verdict("coverage", findings);
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

// Dependencies in the manifest after that were not in it before, of either kind.
export function new_dependencies(before: Manifest | null, after: Manifest | null): string[] {
  const old_names = new Set([...Object.keys(before?.dependencies ?? {}), ...Object.keys(before?.devDependencies ?? {})]);
  return [...Object.keys(after?.dependencies ?? {}), ...Object.keys(after?.devDependencies ?? {})].filter((name) => !old_names.has(name));
}

// Whether a licence is allowed: written exactly as allowed, or an SPDX expression the allowed licences satisfy.
export function licence_allowed(licence: string, allowed: readonly string[]): boolean {
  if (allowed.includes(licence)) return true;
  const identifiers = allowed.filter((each) => /^[\w.+-]+(?: WITH [\w.+-]+)?$/.test(each));
  try {
    return satisfies(licence, identifiers);
  } catch {
    return false;
  }
}

// New dependencies named for review with their licences; one whose licence is not allowed fails.
export function check_dependencies(before: Manifest | null, after: Manifest | null, licence_of: (name: string) => string | null, options: Partial<ChangeCheckOptions> = {}): GateResult {
  const added = new_dependencies(before, after);
  if (!added.length) return passed("dependencies");
  const { allowed_licences } = options_with_defaults(options);
  const found = added.map((name) => {
    const licence = licence_of(name);
    return { licence, line: `${name} is new, licensed ${licence ?? "as it does not say"}` };
  });
  const refused = found.filter((each) => each.licence !== null && !licence_allowed(each.licence, allowed_licences));
  if (refused.length) return { gate: "dependencies", outcome: "failed", findings: refused.map((each) => `${each.line}, which is not among the allowed licences`) };
  return { gate: "dependencies", outcome: "warning", findings: found.map((each) => each.line) };
}

// ── Registry ─────────────────────────────────────────────────────────────────

export type ChangeCheck = (change: Change, options: ChangeCheckOptions) => GateResult | Promise<GateResult>;

function parse_manifest(text: string | null): Manifest | null {
  return text === null ? null : (JSON.parse(text) as Manifest);
}

// The checks X-App carries, by name.
export const builtin_checks: Record<string, ChangeCheck> = {
  commits: (change, options) => check_commits(change.commits, needs_trailer(change.repository, options), options),
  secrets: (change) => check_secrets(change.files, change.texts, change.commits),
  leftovers: (change) => check_leftovers(change.files),
  comments: (change) => check_comments(change.files),
  coverage: (change) => check_coverage(change.vitest_config.before, change.vitest_config.after),
  "x-app": (change, options) => check_x_app(change.files, is_wrapping_repository(change.repository, options), options),
  dependencies: (change, options) => check_dependencies(parse_manifest(change.package_json.before), parse_manifest(change.package_json.after), (name) => change.licences[name] ?? null, options),
};

export interface CheckRegistry {
  // Adds a check, or replaces the one of the same name.
  add(name: string, check: ChangeCheck): void;
  has(name: string): boolean;
  names(): string[];
  // Runs the checks named, in order; an unknown name is skipped and a check that throws fails with why.
  run(names: readonly string[], change: Change, options?: Partial<ChangeCheckOptions>): Promise<GateResult[]>;
}

export function create_check_registry(checks: Record<string, ChangeCheck> = builtin_checks): CheckRegistry {
  const known = new Map(Object.entries(checks));
  return {
    add: (name, check) => void known.set(name, check),
    has: (name) => known.has(name),
    names: () => [...known.keys()],
    async run(names, change, options = {}) {
      const merged = options_with_defaults(options);
      const results: GateResult[] = [];
      for (const name of names) {
        const check = known.get(name);
        if (!check) {
          results.push(skipped(name, `there is no check called ${name}`));
          continue;
        }
        try {
          results.push({ ...(await check(change, merged)), gate: name });
        } catch (error) {
          results.push({ gate: name, outcome: "failed", findings: [`the check could not run: ${error instanceof Error ? error.message : String(error)}`] });
        }
      }
      return results;
    },
  };
}
