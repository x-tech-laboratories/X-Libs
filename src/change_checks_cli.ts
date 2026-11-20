#!/usr/bin/env node
// The `x-libs-check [--base <ref>] [check...]` command: runs the change checks on what changed since a base, for a CI
// job on a pull request, printing each check's findings one per line and failing when any check fails. An app with
// checks of its own calls `run_check_command` with its own registry.

// ── Imports ──────────────────────────────────────────────────────────────────

import { parseArgs } from "node:util";

import { run_program } from "./agent/programs.ts";
import { create_check_registry, type ChangeCheckOptions, type CheckRegistry, type GateResult } from "./change_checks.ts";
import { read_change } from "./change_checks_git.ts";

// ── Options ──────────────────────────────────────────────────────────────────

// The checks run when none are named.
export const default_checks = ["commits", "secrets", "leftovers", "comments", "coverage", "x-libs", "dependencies"];

export interface CheckCommandContext {
  cwd: string;
  env: Record<string, string | undefined>;
  out: { write(text: string): void };
  err: { write(text: string): void };
  registry?: CheckRegistry;
  options?: Partial<ChangeCheckOptions>;
  // The checks run when none are named, the built-in ones unless given.
  default_checks?: readonly string[];
  // The command's name in its usage and errors, x-libs-check unless given.
  command_name?: string;
}

function usage(command_name: string, defaults: readonly string[], names: string[]): string {
  return `Usage: ${command_name} [--base <ref>] [--repository <owner/name>] [--working-tree] [check...]

Runs the change checks on what changed since the base (the branch point from origin/main unless given) and fails
when any check fails. With no checks named it runs: ${defaults.join(", ")}.
Checks: ${names.join(", ")}.
Settings come from the "x-libs-check" key of package.json as it was at the base, so a change cannot loosen its own checks.`;
}

// The settings package.json gives under "x-libs-check", keeping only known keys of the right kind.
export function options_from_manifest(text: string | null): Partial<ChangeCheckOptions> {
  if (text === null) return {};
  const given = (JSON.parse(text) as Record<string, unknown>)["x-libs-check"];
  if (!given || typeof given !== "object") return {};
  const settings = given as Record<string, unknown>;
  const options: Partial<ChangeCheckOptions> = {};
  const is_list = (value: unknown): value is string[] => Array.isArray(value) && value.every((each) => typeof each === "string");
  if (typeof settings.commit_trailer === "string" || settings.commit_trailer === null) options.commit_trailer = settings.commit_trailer;
  if (typeof settings.ai_mention === "string") options.ai_mention = new RegExp(settings.ai_mention, "i");
  if (settings.ai_mention === null) options.ai_mention = null;
  for (const key of ["trailer_organisations", "wrapped_libraries", "wrapping_repositories", "allowed_licences"] as const) {
    if (is_list(settings[key])) options[key] = settings[key];
  }
  return options;
}

// ── Output ───────────────────────────────────────────────────────────────────

const marks = { passed: "✓", failed: "✗", warning: "!", skipped: "-" } as const;

export function format_results(results: readonly GateResult[]): string {
  return results.flatMap((result) => [`${marks[result.outcome]} ${result.gate}: ${result.outcome}`, ...result.findings.map((finding) => `    ${finding}`)]).join("\n");
}

// ── Command ──────────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
  const result = await run_program(["git", ...args], { cwd, stdout: "keep", stderr: "keep" });
  if (result.exit_code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// Runs the command with its arguments, answering the exit code: 0 when nothing failed, 1 when a check failed, 2 when misused.
export async function run_check_command(args: string[], context: CheckCommandContext): Promise<number> {
  const registry = context.registry ?? create_check_registry();
  const command_name = context.command_name ?? "x-libs-check";
  const defaults = context.default_checks ?? default_checks;
  const help = () => usage(command_name, defaults, registry.names());
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { base: { type: "string" }, repository: { type: "string" }, "working-tree": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  } catch (error) {
    context.err.write(`${command_name}: ${error instanceof Error ? error.message : String(error)}\n\n${help()}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    context.out.write(`${help()}\n`);
    return 0;
  }
  const unknown = positionals.filter((name) => !registry.has(name));
  if (unknown.length) {
    context.err.write(`${command_name}: no check called ${unknown.join(", ")}\n\n${help()}\n`);
    return 2;
  }
  try {
    const base = values.base ?? (await git(["merge-base", "origin/main", "HEAD"], context.cwd));
    const repository = values.repository ?? context.env.GITHUB_REPOSITORY;
    const change = await read_change(context.cwd, base, { working_tree: values["working-tree"] ?? false, ...(repository ? { repository } : {}) });
    const manifest_options = options_from_manifest(change.package_json.before ?? change.package_json.after);
    const results = await registry.run(positionals.length ? positionals : defaults, change, { ...manifest_options, ...context.options });
    context.out.write(`${format_results(results)}\n`);
    return results.some((result) => result.outcome === "failed") ? 1 : 0;
  } catch (error) {
    context.err.write(`${command_name}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(await run_check_command(process.argv.slice(2), { cwd: process.cwd(), env: process.env, out: process.stdout, err: process.stderr }));
}

