// GitHub's webhooks on top of `forge_webhook`: a delivery counts only when signed with X-Hub-Signature-256 under the
// app's secret, never by a bearer token or another forge's header; an address that keeps failing waits; a delivery id
// seen before is answered without being passed on again; and of each delivery only the repository and the pull
// requests, branches and issues it names are kept, each checked for shape, for the app to look up for itself.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { IncomingHttpHeaders } from "node:http";

import { AddressLockout, is_signed, parse_payload, type WebhookAnswer } from "./forge_webhook.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// The events that name pull requests, branches or issues, for the app to tick on GitHub.
export const github_target_events = ["pull_request", "check_suite", "check_run", "status", "workflow_run", "issues", "issue_comment"] as const;

export interface WebhookTargets {
  // As owner/name.
  repository: string;
  pull_requests: number[];
  branches: string[];
  issues: number[];
}

export interface GitHubDelivery {
  // GitHub's id for the delivery, from X-GitHub-Delivery, or "" when it gave none.
  delivery_id: string;
  // Lowercase, such as "pull_request" or "ping".
  event: string;
  targets: WebhookTargets;
}

export interface GitHubReceiverOptions {
  // The secret deliveries are signed with, read afresh for each, or "" while there is none.
  secret: () => string;
  // The events passed on; a ping is always answered and passed on too.
  events?: readonly string[];
  // Hears each new delivery once.
  on_delivery: (delivery: GitHubDelivery) => void;
  lockout?: AddressLockout;
  // How many delivery ids are remembered to answer a replay.
  remembered?: number;
  // The words of a refusal for a delivery not signed with the secret.
  unsigned_text?: string;
}

const repository_pattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const branch_pattern = /^[A-Za-z0-9._/-]{1,255}$/;
const delivery_pattern = /^[A-Za-z0-9-]{1,100}$/;
const most_targets = 50;

// ── Reading payloads ─────────────────────────────────────────────────────────

type Fields = Record<string, unknown>;

function fields_of(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : {};
}

function number_of(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 2 ** 31 ? value : null;
}

function branch_of(value: unknown): string | null {
  return typeof value === "string" && branch_pattern.test(value) && !value.includes("..") && !value.startsWith("-") ? value : null;
}

// The pull request numbers in a list such as check_suite.pull_requests, left out where they are not plain numbers.
function numbers_in(list: unknown): number[] {
  return (Array.isArray(list) ? list : []).map((entry) => number_of(fields_of(entry).number)).filter((number): number is number => number !== null);
}

// Whether a name is a repository as owner/name.
export function is_repository_name(name: string): boolean {
  return repository_pattern.test(name);
}

// The repository a payload names as owner/name, or null when it names none that looks like one.
export function repository_of(payload: unknown): string | null {
  const name = fields_of(fields_of(payload).repository).full_name;
  return typeof name === "string" && repository_pattern.test(name) ? name : null;
}

// The delivery id as GitHub sends it, or "" when it is missing or not an id.
export function delivery_id_of(header: unknown): string {
  return typeof header === "string" && delivery_pattern.test(header) ? header : "";
}

// The repository and the pull requests, branches and issues a delivery names, or null; nothing else in it is kept.
export function targets_of(event: string, payload: unknown): WebhookTargets | null {
  const repository = repository_of(payload);
  if (repository === null) return null;
  const values = fields_of(payload);
  const pull_requests: (number | null)[] = [];
  const branches: (string | null)[] = [];
  const issues: (number | null)[] = [];
  if (event === "ping") {
    // Only says the hook works.
  } else if (event === "pull_request") {
    const pull = fields_of(values.pull_request);
    const head = fields_of(pull.head);
    pull_requests.push(number_of(pull.number) ?? number_of(values.number));
    // A fork's branch is not one of the repository's own, so only a branch of the same repository counts.
    if (fields_of(head.repo).full_name === repository) branches.push(branch_of(head.ref));
  } else if (event === "check_suite" || event === "workflow_run") {
    const suite = fields_of(values[event]);
    branches.push(branch_of(suite.head_branch));
    pull_requests.push(...numbers_in(suite.pull_requests));
  } else if (event === "check_run") {
    const run = fields_of(values.check_run);
    branches.push(branch_of(fields_of(run.check_suite).head_branch));
    pull_requests.push(...numbers_in(run.pull_requests));
  } else if (event === "status") {
    branches.push(...(Array.isArray(values.branches) ? values.branches : []).map((branch) => branch_of(fields_of(branch).name)));
  } else if (event === "issues" || event === "issue_comment") {
    issues.push(number_of(fields_of(values.issue).number));
  } else return null;
  const kept = <Value>(list: (Value | null)[]): Value[] => [...new Set(list.filter((value): value is Value => value !== null))].slice(0, most_targets);
  return { repository, pull_requests: kept(pull_requests), branches: kept(branches), issues: kept(issues) };
}

// A delivery's targets as stored, each list left empty where the stored text is damaged.
export function read_targets(repository: string, stored: string): WebhookTargets {
  let fields: Fields = {};
  try {
    fields = fields_of(JSON.parse(stored));
  } catch {
    fields = {};
  }
  const numbers = (value: unknown) => (Array.isArray(value) ? value.map(number_of).filter((number): number is number => number !== null) : []);
  const names = Array.isArray(fields.branches) ? fields.branches.map(branch_of).filter((branch): branch is string => branch !== null) : [];
  return { repository, pull_requests: numbers(fields.pull_requests), branches: names, issues: numbers(fields.issues) };
}

// ── Addresses ────────────────────────────────────────────────────────────────

// A public address as saved: http or https with a host and maybe a path, no query, fragment or user; anything else throws.
export function read_public_url(typed: string): string {
  const trimmed = typed.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Give the address GitHub reaches this server at, such as https://example.org.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.search || url.hash || url.username || url.password) throw new Error("The address is http or https with a host and a path, and nothing more.");
  return trimmed;
}

// The payload URL for a public address and the route's path, or "" when no address is given.
export function payload_url_of(public_url: string, path: string): string {
  const trimmed = public_url.trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}${path}` : "";
}

// ── Receiving ────────────────────────────────────────────────────────────────

// Answers deliveries as `register_webhook_route`'s receive.
export function create_github_receiver({ secret, events = github_target_events, on_delivery, lockout = new AddressLockout(), remembered = 1000, unsigned_text = "The delivery is not signed with this server's webhook secret." }: GitHubReceiverOptions): (address: string, headers: IncomingHttpHeaders, body: Buffer) => WebhookAnswer {
  // Delivery ids already taken, oldest first, so a replayed delivery is answered without being passed on again.
  const seen = new Set<string>();

  return (address, headers, body) => {
    if (lockout.is_locked(address)) return { status: 429, body: { message: "Too many deliveries were not signed; try again later." } };
    const key = secret();
    const signature = headers["x-hub-signature-256"];
    if (key === "" || typeof signature !== "string" || !is_signed({ "x-hub-signature-256": signature }, body, key)) {
      lockout.fail(address);
      return { status: 401, body: { message: unsigned_text } };
    }
    lockout.succeed(address);

    const header = headers["x-github-event"];
    const event = typeof header === "string" ? header.toLowerCase() : "";
    const targets = event === "ping" || events.includes(event) ? targets_of(event, parse_payload(body, headers["content-type"])) : null;
    if (targets === null) return { status: 204, body: { message: "" } };

    const delivery_id = delivery_id_of(headers["x-github-delivery"]);
    if (delivery_id && seen.has(delivery_id)) return { status: 200, body: { message: "Already received." } };
    if (delivery_id) {
      seen.add(delivery_id);
      if (seen.size > remembered) seen.delete(seen.values().next().value!);
    }
    on_delivery({ delivery_id, event, targets });
    return { status: 202, body: { message: event === "ping" ? "Pong." : "Received." } };
  };
}
