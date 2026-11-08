// Signing in to a server that has one secret: a browser posts it on the login page and keeps a cookie derived from it,
// other programs send it as a bearer header, and the guard turns away every request that carries neither. The guard
// alone also serves servers with their own sessions, which hand it the check.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";

import fastify_cookie from "@fastify/cookie";
import fastify_formbody from "@fastify/formbody";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { render_login_page } from "./login_page.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface SignInGuardOptions {
  // Whether the request is signed in.
  is_signed_in: (request: FastifyRequest) => boolean;
  // Paths under this prefix get a 401 instead of the login page; "/api/" unless set.
  api_prefix?: string;
  // Paths reached without signing in, such as a health check or an agent socket.
  open_paths?: Iterable<string>;
  // Where a page load that is not signed in goes; null leaves pages open, for an app whose page logs in itself.
  login_path?: string | null;
  // How a refused call answers: plain text, or JSON as { error }.
  refusal?: "text" | "json";
  // What a refused call says.
  refusal_text?: string;
}

export interface TokenSignInOptions extends Omit<SignInGuardOptions, "is_signed_in"> {
  // The secret browsers sign in with; empty leaves the server open.
  secret: string;
  // The app's name, for the login page.
  title: string;
  // The session cookie's name; derived from the title unless set.
  cookie_name?: string;
  // How long a signed-in browser stays signed in; 90 days unless set.
  session_seconds?: number;
  // How long a wrong token waits before being refused; a second unless set.
  failed_login_delay_ms?: number;
  // The login route, which also names where the guard sends page loads; "/login" unless set.
  login_path?: string;
  // The logout route; "/logout" unless set.
  logout_path?: string;
  // Where a browser goes once signed in; the site's root unless set.
  home_path?: string;
  // Draws the login page; the standard page unless set.
  render_login_page?: (has_failed: boolean) => string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const default_session_seconds = 90 * 24 * 60 * 60;
const default_failed_login_delay_ms = 1000;

// ── Secrets ──────────────────────────────────────────────────────────────────

export function same_secret(first: string, second: string): boolean {
  const first_bytes = Buffer.from(first);
  const second_bytes = Buffer.from(second);
  return first_bytes.length === second_bytes.length && timingSafeEqual(first_bytes, second_bytes);
}

// The cookie holds a value derived from the secret, so changing the secret signs every browser out.
export function session_value(secret: string, cookie_name: string): string {
  return createHmac("sha256", secret).update(cookie_name).digest("hex");
}

export function cookie_name_for(title: string): string {
  return `${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "")}_session`;
}

// A browser signs in with its cookie; other programs can send the secret as a bearer header instead.
export function is_token_signed_in(request: FastifyRequest, secret: string, cookie_name: string): boolean {
  if (secret === "") return true;
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  if (bearer !== undefined) return same_secret(bearer, secret);
  return same_secret(request.cookies[cookie_name] ?? "", session_value(secret, cookie_name));
}

// A proxy that ends TLS says so in a header, and the cookie is then kept to secure connections.
function is_secure(request: FastifyRequest): boolean {
  return request.headers["x-forwarded-proto"] === "https" || "encrypted" in request.raw.socket;
}

function set_session_cookie(request: FastifyRequest, reply: FastifyReply, cookie_name: string, value: string, max_age_seconds: number): void {
  void reply.setCookie(cookie_name, value, { path: "/", httpOnly: true, sameSite: "strict", maxAge: max_age_seconds, secure: is_secure(request) });
}

// ── Guard ────────────────────────────────────────────────────────────────────

export function path_of(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? "";
}

// Turns away every request that is not signed in: a page load goes to the login page, while a call gets a refusal it can act on.
export function register_sign_in_guard(app: FastifyInstance, options: SignInGuardOptions): void {
  const { is_signed_in, api_prefix = "/api/", login_path = "/login", refusal = "text", refusal_text = "sign in first" } = options;
  const open_paths = new Set(options.open_paths ?? []);

  app.addHook("onRequest", async (request, reply) => {
    const path = path_of(request);
    // Preflight checks carry no credentials, and the sign-in routes are open by nature.
    if (request.method === "OPTIONS" || open_paths.has(path)) return;
    if (is_signed_in(request)) return;
    if (!path.startsWith(api_prefix)) {
      if (login_path === null) return;
      return reply.redirect(login_path, 303);
    }
    void reply.code(401).header("cache-control", "no-store");
    if (refusal === "json") return reply.send({ error: refusal_text });
    return reply.type("text/plain; charset=utf-8").send(refusal_text);
  });
}

// ── Token sign-in ────────────────────────────────────────────────────────────

// Signs browsers in and out with the server's one secret, and guards everything else.
export async function register_token_sign_in(app: FastifyInstance, options: TokenSignInOptions): Promise<void> {
  const {
    secret, title, login_path = "/login", logout_path = "/logout", home_path = "/",
    session_seconds = default_session_seconds, failed_login_delay_ms = default_failed_login_delay_ms,
  } = options;
  const cookie_name = options.cookie_name ?? cookie_name_for(title);
  const render = options.render_login_page ?? ((has_failed: boolean) => render_login_page({ title, has_failed, action: login_path }));

  await app.register(fastify_cookie);
  await app.register(fastify_formbody);

  register_sign_in_guard(app, {
    ...options,
    login_path,
    open_paths: [login_path, logout_path, ...(options.open_paths ?? [])],
    is_signed_in: (request) => is_token_signed_in(request, secret, cookie_name),
  });

  app.get(login_path, async (_request, reply) => reply.type("text/html; charset=utf-8").send(render(false)));

  app.post<{ Body: { token?: string } }>(login_path, async (request, reply) => {
    const token = request.body?.token ?? "";
    if (secret === "" || same_secret(token, secret)) {
      set_session_cookie(request, reply, cookie_name, session_value(secret, cookie_name), session_seconds);
      return reply.redirect(home_path, 303);
    }
    await new Promise((wait) => setTimeout(wait, failed_login_delay_ms));
    return reply.code(401).type("text/html; charset=utf-8").send(render(true));
  });

  app.get(logout_path, async (request, reply) => {
    set_session_cookie(request, reply, cookie_name, "", 0);
    return reply.redirect(login_path, 303);
  });
}
