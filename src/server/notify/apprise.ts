// Apprise, which reaches most chat, push and SMS services: the `apprise` program sends each notification, as no Node
// library exists. Its URLs hold secrets, so they reach it through its APPRISE_URLS variable, never on its command line.

// ── Imports ──────────────────────────────────────────────────────────────────

import { not_installed_exit_code, run_program, type ProgramOptions, type ProgramResult } from "../../agent/programs.ts";
import { setting_secret } from "./settings.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// Apprise's severity, which some services show as a colour or icon.
export type AppriseType = "info" | "success" | "warning" | "failure";

export interface AppriseMessage {
  title: string;
  body: string;
  type: AppriseType;
}

export type ProgramRunner = (argv: readonly string[], options: ProgramOptions) => Promise<ProgramResult>;

export interface AppriseOptions {
  // The program run; "apprise" from the PATH unless set.
  program?: string;
  run?: ProgramRunner;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// A delivery that takes longer is stopped and counts as failed.
export const apprise_timeout_in_milliseconds = 60_000;

// A URL needs a scheme, such as "ntfys://" or "mailto://".
const url_pattern = /^[a-z][a-z0-9+.-]*:\/\/\S*$/i;

// The URLs from `urls`, one or a list, and from the lines of `urls_file`, skipping blanks and # comments.
export function apprise_urls(config: Record<string, unknown>): string[] {
  const inline = config.urls ?? [];
  const urls = (Array.isArray(inline) ? inline : [inline]).filter((url) => url !== "" && url !== null).map(String);
  if (config.urls_file) {
    const listed = setting_secret({ urls_file: config.urls_file }, "urls") ?? "";
    urls.push(...listed.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")));
  }
  if (urls.length === 0) throw new Error("an apprise channel needs `urls` or `urls_file`");
  if (urls.some((url) => !url_pattern.test(url))) throw new Error("an apprise URL was not recognised; check its scheme and format");
  return urls;
}

// ── Sending ──────────────────────────────────────────────────────────────────

export async function send_apprise(urls: readonly string[], message: AppriseMessage, options: AppriseOptions = {}): Promise<void> {
  const program = options.program ?? "apprise";
  const run = options.run ?? run_program;
  const result = await run([program, "--title", message.title, "--body", message.body || message.title, "--notification-type", message.type], {
    env: { ...process.env, APPRISE_URLS: urls.join(" ") }, stdout: "drop", stderr: "keep", stdin: "",
    signal: AbortSignal.timeout(apprise_timeout_in_milliseconds), own_group: true,
  });
  if (result.exit_code === not_installed_exit_code) throw new Error(`an apprise channel needs the ${program} program, which is not installed`);
  if (result.exit_code !== 0) {
    const detail = result.stderr.trim().split("\n").pop() ?? "";
    throw new Error(`Apprise could not deliver to one or more of its URLs${detail ? `: ${detail}` : ""}`);
  }
}
