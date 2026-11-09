// Pushes from a forge such as GitHub, Gitea, Forgejo or GitLab: whether a delivery is signed with the shared secret, what
// event and push it carries, a lockout for an address that keeps failing to sign, a debounce for a burst of pushes, and the
// route that takes deliveries with the raw body kept, since the signature covers its exact bytes.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import type { FastifyInstance } from "fastify";

// ── Shapes ───────────────────────────────────────────────────────────────────

// A push payload's facts for picking what follows the repository.
export interface Push {
  // Every URL the payload gives for the repository, normalised by the app.
  repositories: Set<string>;
  branch: string;
  default_branch: string | null;
}

export interface WebhookAnswer {
  status: number;
  body: { message: string; matched?: string[] };
}

export interface WebhookRouteOptions {
  // Where deliveries are posted; "/api/webhook" unless set.
  path?: string;
  // Answers one delivery from the address, its headers and its raw body.
  receive: (address: string, headers: IncomingHttpHeaders, body: Buffer) => WebhookAnswer;
  // Called when the app closes.
  close?: () => void;
  // Forge payloads can be large, as a push lists its commits; 10 MiB unless set.
  body_limit_in_bytes?: number;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// The headers forges name their event in.
const event_headers = ["x-github-event", "x-gitea-event", "x-forgejo-event", "x-gitlab-event"];

const default_body_limit_in_bytes = 10 * 1024 * 1024;

// ── Checking ─────────────────────────────────────────────────────────────────

function same_text(first: string, second: string): boolean {
  // Digests have equal lengths, so the comparison takes the same time whatever the texts are.
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(first), digest(second));
}

// Whether the request carries a signature of its body, or a bearer token, made with the secret.
export function is_signed(headers: IncomingHttpHeaders, body: Buffer, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const github = headers["x-hub-signature-256"];
  if (typeof github === "string" && github.startsWith("sha256=")) return same_text(github.slice("sha256=".length).toLowerCase(), expected);
  for (const name of ["x-forgejo-signature", "x-gitea-signature"]) {
    const signature = headers[name];
    if (typeof signature === "string" && signature !== "") return same_text(signature.toLowerCase(), expected);
  }
  const authorization = headers.authorization;
  if (typeof authorization === "string" && /^bearer /i.test(authorization)) return same_text(authorization.slice("bearer ".length).trim(), secret);
  const gitlab = headers["x-gitlab-token"];
  if (typeof gitlab === "string" && gitlab !== "") return same_text(gitlab, secret);
  return false;
}

// The event the forge names, or "push" when it names none.
export function event_of(headers: IncomingHttpHeaders): string {
  for (const name of event_headers) {
    const value = headers[name];
    if (typeof value === "string" && value !== "") return value.toLowerCase();
  }
  return "push";
}

// The JSON payload, also from a form whose `payload` field holds it, or null for anything else.
export function parse_payload(body: Buffer, content_type: string | undefined): unknown {
  let text = body.toString("utf8");
  if ((content_type ?? "").startsWith("application/x-www-form-urlencoded")) text = new URLSearchParams(text).get("payload") ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The branch a push payload moved and the repository URLs it gives, each through `normalize` (null drops it), or null for a
// tag, a deleted branch or no push at all.
export function read_push(payload: unknown, normalize: (url: string) => string | null): Push | null {
  if (typeof payload !== "object" || payload === null) return null;
  const values = payload as Record<string, unknown>;
  if (typeof values.ref !== "string" || !values.ref.startsWith("refs/heads/") || values.deleted === true) return null;
  const repository = (typeof values.repository === "object" && values.repository !== null ? values.repository : {}) as Record<string, unknown>;
  const repositories = new Set<string>();
  for (const key of ["clone_url", "ssh_url", "git_url", "html_url", "url", "git_http_url", "git_ssh_url"]) {
    const url = repository[key];
    const normalized = typeof url === "string" ? normalize(url) : null;
    if (normalized !== null) repositories.add(normalized);
  }
  if (repositories.size === 0) return null;
  const default_branch = typeof repository.default_branch === "string" ? repository.default_branch : null;
  return { repositories, branch: values.ref.slice("refs/heads/".length), default_branch };
}

// ── Lockout ──────────────────────────────────────────────────────────────────

// Turns an address away for a while once it has failed to sign too many deliveries in a row.
export class AddressLockout {
  private readonly failures = new Map<string, { count: number; until: number }>();
  private readonly failures_allowed: number;
  private readonly lockout_in_milliseconds: number;
  private readonly now: () => number;

  constructor(options: { failures_allowed?: number; lockout_in_milliseconds?: number; now?: () => number } = {}) {
    this.failures_allowed = options.failures_allowed ?? 10;
    this.lockout_in_milliseconds = options.lockout_in_milliseconds ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  // Whether the address has to wait before trying again.
  is_locked(address: string): boolean {
    const failure = this.failures.get(address);
    return failure !== undefined && failure.count >= this.failures_allowed && failure.until > this.now();
  }

  fail(address: string): void {
    const failure = this.failures.get(address);
    const count = (failure && failure.until > this.now() ? failure.count : 0) + 1;
    this.failures.set(address, { count, until: this.now() + this.lockout_in_milliseconds });
  }

  succeed(address: string): void {
    this.failures.delete(address);
  }
}

// ── Debounce ─────────────────────────────────────────────────────────────────

// Runs work once the quiet after the last request for the same id ends, so a burst of pushes starts one run.
export class Debouncer {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly delay_in_seconds: number;

  constructor(delay_in_seconds: number) {
    this.delay_in_seconds = delay_in_seconds;
  }

  schedule(id: string, work: () => unknown): void {
    clearTimeout(this.timers.get(id));
    if (this.delay_in_seconds <= 0) {
      work();
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(id);
      work();
    }, this.delay_in_seconds * 1000);
    timer.unref();
    this.timers.set(id, timer);
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

// Takes deliveries with the raw body kept, in a scope of its own so the app's other routes parse as they did.
export async function register_webhook_route(app: FastifyInstance, options: WebhookRouteOptions): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: options.body_limit_in_bytes ?? default_body_limit_in_bytes }, (_request, body, done) => done(null, body));
    scope.post(options.path ?? "/api/webhook", async (request, reply) => {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const answer = options.receive(request.ip, request.headers, body);
      return reply.code(answer.status).send(answer.body);
    });
  });
  if (options.close !== undefined) app.addHook("onClose", async () => options.close!());
}
