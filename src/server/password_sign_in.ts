// Signing in by name and password: the names and hashes come from an accounts file, a right pair opens a session the
// server keeps, and every API path but the open ones needs it. A wrong name takes as long to refuse as a wrong password,
// an address gets a few tries before it waits, and a restart signs everyone out.

// ── Imports ──────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";

import fastify_cookie from "@fastify/cookie";
import fastify_rate_limit from "@fastify/rate-limit";
import fastify_session from "@fastify/session";
import type { FastifyInstance } from "fastify";

import { hash_password, verify_password, type Accounts } from "./passwords.ts";
import { register_sign_in_guard } from "./sign_in.ts";

declare module "fastify" {
  interface Session {
    // The account the session is signed in as.
    name?: string;
  }
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface PasswordSignInOptions {
  accounts: Accounts;
  // The session cookie's name, such as "x_nix_session".
  cookie_name: string;
  // How long a session lasts; twelve hours unless set.
  lifetime_in_milliseconds?: number;
  // Where the login, logout and me routes live, and the paths that need a session; "/api" unless set.
  api_prefix?: string;
  // Paths reached without signing in, such as a health check, an agent socket or a webhook.
  open_paths?: Iterable<string>;
  // How many tries one address gets in the window before it waits; 5 in "5 minutes" unless set.
  tries_allowed?: number;
  try_window?: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const default_lifetime_in_milliseconds = 12 * 60 * 60 * 1000;

// An unknown name is checked against this hash, so it takes as long to refuse as a wrong password.
const stand_in_hash = hash_password(randomBytes(16).toString("hex"));

// ── Registration ─────────────────────────────────────────────────────────────

// POST <prefix>/login takes { name, password }, POST <prefix>/logout ends the session, GET <prefix>/me names who is in.
export async function register_password_sign_in(app: FastifyInstance, options: PasswordSignInOptions): Promise<void> {
  const prefix = options.api_prefix ?? "/api";
  const login_path = `${prefix}/login`;

  await app.register(fastify_cookie);
  await app.register(fastify_session, {
    secret: randomBytes(32).toString("hex"),
    cookieName: options.cookie_name,
    saveUninitialized: false,
    cookie: { path: "/", httpOnly: true, sameSite: "strict", secure: "auto", maxAge: options.lifetime_in_milliseconds ?? default_lifetime_in_milliseconds },
  });
  await app.register(fastify_rate_limit, {
    global: false,
    errorResponseBuilder: () => Object.assign(new Error("Too many tries; wait a few minutes."), { statusCode: 429 }),
  });

  // The page loads without a session and signs in itself, so only API calls are turned away.
  register_sign_in_guard(app, {
    is_signed_in: (request) => request.session.name !== undefined,
    api_prefix: `${prefix}/`,
    login_path: null,
    refusal: "json",
    refusal_text: "Log in first.",
    open_paths: [login_path, ...(options.open_paths ?? [])],
  });

  app.post<{ Body: { name?: unknown; password?: unknown } }>(login_path, {
    config: { rateLimit: { max: options.tries_allowed ?? 5, timeWindow: options.try_window ?? "5 minutes" } },
  }, async (request, reply) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim().toLowerCase() : "";
    const password = request.body?.password;
    const stored = options.accounts.get(name);
    const matches = typeof password === "string" && verify_password(password, stored ?? stand_in_hash);
    if (stored === undefined || !matches) return reply.code(401).send({ error: "Wrong name or password." });
    // A fresh session id at login, so one handed out before it cannot ride along.
    await request.session.regenerate();
    request.session.name = name;
    return reply.code(204).send();
  });

  app.post(`${prefix}/logout`, async (request, reply) => {
    await request.session.destroy();
    return reply.code(204).send();
  });

  app.get(`${prefix}/me`, async (request) => ({ logged_in: true, name: request.session.name }));
}
