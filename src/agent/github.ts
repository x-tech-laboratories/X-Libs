// GitHub through the gh program the user is signed into, so the app never holds a token of its own: signing gh in and
// out, finding an open issue that matches a title or opening one, an issue's labels, body, comments and closing, a
// branch's pull request and its checks, and a repository's webhook. Every call runs gh with its arguments and no shell,
// and anything secret, such as a body or a hook's secret, goes on gh's standard input, never its command line.

// ── Imports ──────────────────────────────────────────────────────────────────

import { not_installed_exit_code, run_program } from "./programs.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface GitHubAccount {
  signed_in: boolean;
  account: string;
  // Why it cannot tell, such as gh not being installed; empty otherwise.
  problem: string;
}

export interface GitHubSignIn {
  // The one-time code to enter on GitHub's device page.
  code: string;
  url: string;
}

export interface IssueRequest {
  // As owner/name.
  repository: string;
  title: string;
  body: string;
}

export interface IssueLink {
  number: number;
  // Whether it was opened now rather than found already open.
  opened: boolean;
}

export interface IssueState {
  open: boolean;
  labels: string[];
  body: string;
}

export interface IssueEdit {
  add_labels?: string[];
  remove_labels?: string[];
  body?: string;
}

export interface LabelStyle {
  // Narrows the labels read to those matching, such as "stage:", since a repository may have hundreds.
  search?: string;
  // Six hex digits without the #.
  colour?: string;
  description?: string;
}

export type PullRequestState = "open" | "closed" | "merged";

export interface PullRequestFound {
  number: number;
  url: string;
  state: PullRequestState;
  draft: boolean;
}

export const check_buckets = ["pass", "fail", "pending", "skipping", "cancel"] as const;

export type CheckBucket = (typeof check_buckets)[number];

export interface PullRequestCheck {
  name: string;
  workflow: string;
  bucket: CheckBucket;
  link: string;
}

export interface HookConfig {
  url: string;
  secret: string;
  events: readonly string[];
}

export interface GitHubCli {
  account: () => Promise<GitHubAccount>;
  // Starts gh's browser sign-in, giving back the code to enter on GitHub; on_done hears when gh has stored the token.
  start_sign_in: (on_done: (signed_in: boolean) => void) => Promise<GitHubSignIn>;
  // Signs gh out of the account, for every program on this computer that uses it.
  sign_out: (account: string) => Promise<void>;
  // An open issue whose title is close enough to the request's, or a new one with its title and body.
  find_or_open_issue: (request: IssueRequest) => Promise<IssueLink>;
  view_issue: (repository: string, number: number) => Promise<IssueState>;
  // Makes the labels named that the repository lacks, leaving every other label alone.
  ensure_labels: (repository: string, names: string[], style?: LabelStyle) => Promise<void>;
  edit_issue: (repository: string, number: number, edit: IssueEdit) => Promise<void>;
  // Posts a comment on the issue or pull request and gives back its id.
  post_comment: (repository: string, number: number, body: string) => Promise<number>;
  // Replaces a comment's text; false when the comment is gone, such as deleted on GitHub.
  update_comment: (repository: string, id: number, body: string) => Promise<boolean>;
  close_issue: (repository: string, number: number) => Promise<void>;
  // The newest pull request from the branch, open or not, or null when there is none.
  find_pull_request: (repository: string, branch: string) => Promise<PullRequestFound | null>;
  view_pull_request: (repository: string, number: number) => Promise<PullRequestFound>;
  // The pull request's checks, each with how it went; none when the branch has no checks yet.
  read_checks: (repository: string, number: number) => Promise<PullRequestCheck[]>;
  // Adds the hook, or updates the one posting to the same URL, and says which.
  register_hook: (repository: string, hook: HookConfig) => Promise<"added" | "updated">;
}

export interface GitHubCliOptions {
  // The gh program; "gh" on the PATH unless set.
  program?: string;
  host?: string;
  // How long sign-in waits for gh to print its code.
  code_wait_in_milliseconds?: number;
}

// ── Titles ───────────────────────────────────────────────────────────────────

function words_of(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

// How alike two titles are, from 0 to 1, by the words of three letters or more they share.
export function title_likeness(first: string, second: string): number {
  const first_words = words_of(first);
  const second_words = words_of(second);
  if (!first_words.size || !second_words.size) return 0;
  const shared = [...first_words].filter((word) => second_words.has(word)).length;
  return shared / new Set([...first_words, ...second_words]).size;
}

// How alike an open issue's title must be to be taken as the same work.
export const same_issue_likeness = 0.6;

// The issue whose title is closest to the one given, if close enough to be the same work.
export function best_title_match(title: string, issues: { number: number; title: string }[], least = same_issue_likeness): number | null {
  let best: { number: number; likeness: number } | null = null;
  for (const issue of issues) {
    const likeness = title_likeness(title, issue.title);
    if (likeness >= least && (!best || likeness > best.likeness)) best = { number: issue.number, likeness };
  }
  return best?.number ?? null;
}

// ── Client ───────────────────────────────────────────────────────────────────

const issues_searched = 20;
const labels_listed = 200;
const device_page = "https://github.com/login/device";

// gh pr checks ends with 8 while checks run and 1 when one failed, still printing them.
const checks_exit_codes = [1, 8];

function as_found(read: { number: number; url: string; state: string; isDraft?: boolean }): PullRequestFound {
  const state = read.state === "MERGED" ? "merged" : read.state === "CLOSED" ? "closed" : "open";
  return { number: read.number, url: read.url, state, draft: read.isDraft === true };
}

const pull_request_fields = "number,url,state,isDraft";

export function github_cli({ program = "gh", host = "github.com", code_wait_in_milliseconds = 20_000 }: GitHubCliOptions = {}): GitHubCli {
  const missing = `${program} is not installed or not on the PATH`;

  // Exit codes besides 0 whose output is still the answer, such as gh pr checks while checks run.
  async function gh(args: string[], stdin: string | null = null, also_fine: number[] = []): Promise<string> {
    const result = await run_program([program, ...args], { stdin, stdout: "keep", stderr: "keep" });
    if (result.exit_code === not_installed_exit_code) throw new Error(`${missing}; GitHub is reached through it`);
    if (result.exit_code !== 0 && !(also_fine.includes(result.exit_code) && result.stdout.trim())) throw new Error(`gh ${args[0]} ${args[1]} failed: ${result.stderr.trim().split("\n").at(-1) || `exit ${result.exit_code}`}`);
    return result.stdout.trim();
  }

  return {
    account: async () => {
      const result = await run_program([program, "auth", "status", "--hostname", host], { stdout: "keep", stderr: "keep" });
      if (result.exit_code === not_installed_exit_code) return { signed_in: false, account: "", problem: missing };
      const account = /Logged in to \S+ (?:account|as) (\S+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1] ?? "";
      return result.exit_code === 0 && account ? { signed_in: true, account, problem: "" } : { signed_in: false, account: "", problem: "" };
    },

    start_sign_in: (on_done) =>
      new Promise((resolve, reject) => {
        let seen = "";
        let answered = false;
        const watch = {
          write: (chunk: Buffer | string) => {
            seen += chunk.toString();
            const code = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(seen)?.[1];
            if (code && !answered) {
              answered = true;
              clearTimeout(timer);
              resolve({ code, url: /https:\/\/\S+\/login\/device/.exec(seen)?.[0] ?? device_page });
            }
          },
        };
        const last_words = () => seen.trim().split("\n").at(-1) ?? "";
        const timer = setTimeout(() => {
          if (answered) return;
          answered = true;
          reject(new Error(`gh gave no sign-in code: ${last_words() || "no answer"}`));
        }, code_wait_in_milliseconds);
        // The Enter answers gh's prompt to open a browser; the page offers its own link instead.
        void run_program([program, "auth", "login", "--hostname", host, "--web", "--git-protocol", "ssh", "--skip-ssh-key"], { stdin: "\n", stdout: "show", stderr: "show", out: watch, err: watch }).then((result) => {
          if (!answered) {
            answered = true;
            clearTimeout(timer);
            reject(new Error(result.exit_code === not_installed_exit_code ? missing : `gh could not start signing in: ${last_words() || `exit ${result.exit_code}`}`));
          }
          on_done(result.exit_code === 0);
        });
      }),

    sign_out: async (account) => {
      await gh(["auth", "logout", "--hostname", host, "--user", account]);
    },

    find_or_open_issue: async ({ repository, title, body }) => {
      const listed = await gh(["issue", "list", "--repo", repository, "--state", "open", "--search", `${title} in:title`, "--json", "number,title", "--limit", String(issues_searched)]);
      const found = best_title_match(title, JSON.parse(listed || "[]") as { number: number; title: string }[]);
      if (found !== null) return { number: found, opened: false };
      const url = await gh(["issue", "create", "--repo", repository, "--title", title, "--body-file", "-"], body || title);
      const number = Number(/\/issues\/(\d+)\s*$/.exec(url)?.[1]);
      if (!Number.isInteger(number)) throw new Error(`gh opened an issue but gave no number: ${url}`);
      return { number, opened: true };
    },

    view_issue: async (repository, number) => {
      const read = JSON.parse(await gh(["issue", "view", String(number), "--repo", repository, "--json", "state,labels,body"])) as { state: string; labels: { name: string }[]; body: string };
      return { open: read.state === "OPEN", labels: read.labels.map((label) => label.name), body: read.body ?? "" };
    },

    ensure_labels: async (repository, names, style = {}) => {
      const search = style.search ? ["--search", style.search] : [];
      const listed = JSON.parse((await gh(["label", "list", "--repo", repository, ...search, "--json", "name", "--limit", String(labels_listed)])) || "[]") as { name: string }[];
      const known = new Set(listed.map((label) => label.name.toLowerCase()));
      const looks = [...(style.colour ? ["--color", style.colour] : []), ...(style.description ? ["--description", style.description] : [])];
      for (const name of names.filter((each) => !known.has(each.toLowerCase()))) {
        // Another program may have made it in the meantime, which is as good.
        await gh(["label", "create", name, "--repo", repository, ...looks]).catch((error: unknown) => {
          if (!String(error).includes("already exists")) throw error;
        });
      }
    },

    edit_issue: async (repository, number, edit) => {
      const args = ["issue", "edit", String(number), "--repo", repository];
      if (edit.add_labels?.length) args.push("--add-label", edit.add_labels.join(","));
      if (edit.remove_labels?.length) args.push("--remove-label", edit.remove_labels.join(","));
      if (edit.body !== undefined) args.push("--body-file", "-");
      await gh(args, edit.body ?? null);
    },

    post_comment: async (repository, number, body) => {
      const url = await gh(["issue", "comment", String(number), "--repo", repository, "--body-file", "-"], body);
      const id = Number(/#issuecomment-(\d+)\s*$/.exec(url)?.[1]);
      if (!Number.isInteger(id)) throw new Error(`gh posted a comment but gave no id: ${url}`);
      return id;
    },

    update_comment: async (repository, id, body) => {
      try {
        await gh(["api", "--method", "PATCH", `repos/${repository}/issues/comments/${id}`, "--input", "-"], JSON.stringify({ body }));
        return true;
      } catch (error) {
        if (/Not Found|404/.test(String(error))) return false;
        throw error;
      }
    },

    close_issue: async (repository, number) => {
      await gh(["issue", "close", String(number), "--repo", repository]);
    },

    find_pull_request: async (repository, branch) => {
      const listed = JSON.parse((await gh(["pr", "list", "--repo", repository, "--head", branch, "--state", "all", "--json", pull_request_fields, "--limit", "1"])) || "[]") as Parameters<typeof as_found>[0][];
      return listed[0] ? as_found(listed[0]) : null;
    },

    view_pull_request: async (repository, number) => as_found(JSON.parse(await gh(["pr", "view", String(number), "--repo", repository, "--json", pull_request_fields]))),

    read_checks: async (repository, number) => {
      let text: string;
      try {
        text = await gh(["pr", "checks", String(number), "--repo", repository, "--json", "name,bucket,link,workflow"], null, checks_exit_codes);
      } catch (error) {
        if (String(error).includes("no checks reported")) return [];
        throw error;
      }
      const read = JSON.parse(text || "[]") as { name: string; bucket: string; link?: string; workflow?: string }[];
      return read.map((check) => ({ name: check.name, workflow: check.workflow ?? "", bucket: check_buckets.includes(check.bucket as CheckBucket) ? (check.bucket as CheckBucket) : "pending", link: check.link ?? "" }));
    },

    register_hook: async (repository, hook) => {
      const listed = JSON.parse((await gh(["api", "--method", "GET", `repos/${repository}/hooks`])) || "[]") as { id: number; config?: { url?: string } }[];
      const existing = listed.find((each) => each.config?.url === hook.url);
      const body = JSON.stringify({ ...(existing ? {} : { name: "web" }), active: true, events: hook.events, config: { url: hook.url, content_type: "json", secret: hook.secret, insecure_ssl: "0" } });
      if (existing) await gh(["api", "--method", "PATCH", `repos/${repository}/hooks/${existing.id}`, "--input", "-"], body);
      else await gh(["api", "--method", "POST", `repos/${repository}/hooks`, "--input", "-"], body);
      return existing ? "updated" : "added";
    },
  };
}
