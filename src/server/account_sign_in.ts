// Signing in to an app with accounts: a name and password (with a second factor when the user has one), a single sign-on
// provider or a trusted proxy's header opens a session kept in the database, a device or script sends a token instead,
// and every API call is checked against the role it needs.
//
// "Keep me signed in" unticked gives a cookie that ends with the browser; ticked, one that lasts until the session is
// revoked. Both lifetimes can be bounded.

// ── Imports ──────────────────────────────────────────────────────────────────

import fastify_cookie, { type CookieSerializeOptions } from "@fastify/cookie";
import fastify_rate_limit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AccountError, type AccountStore, type User } from "./account_store.ts";
import type { OidcClient } from "./oidc.ts";
import { path_of, register_sign_in_guard } from "./sign_in.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface Viewer {
  name: string;
  role: string;
  // The app's own rules for what the viewer reaches, or null for everything.
  access: unknown;
  via: "session" | "token" | "proxy";
  // A read-only token can only make GET requests.
  read_only: boolean;
  // The session or token the request came with, or null through the proxy.
  credential_id: number | null;
}

declare module "fastify" {
  interface FastifyRequest {
    viewer: Viewer | null;
  }
}

// What a request needs: nothing, anyone signed in, or at least a role.
export type Need = "open" | "any" | { role: string };

export interface ProxySignIn {
  // The header a trusted reverse proxy sets to the signed-in user's name.
  header: string;
  // The addresses that proxy connects from; the header is ignored from anywhere else.
  trusted: Set<string>;
}

export interface AccountSignInOptions {
  accounts: AccountStore;
  // The session cookie's name, such as "x_backups_session".
  cookie_name: string;
  // Where the account routes live and the paths that need signing in; "/api" unless set.
  api_prefix?: string;
  // Paths reached without signing in, such as a health check, an agent socket or a webhook.
  open_paths?: Iterable<string>;
  // Paths outside the API that still need signing in, such as /metrics; `needed` decides what they need.
  guarded_paths?: Iterable<string>;
  // Paths a read-only token may send any method to, as the route itself keeps such a token to reading, such as /api/mcp.
  read_only_paths?: Iterable<string>;
  // What each of the app's own API routes needs; anyone signed in unless set.
  needed?: (method: string, path: string) => Need;
  oidc?: OidcClient | null;
  proxy?: ProxySignIn | null;
  // How long a session lasts with "Keep me signed in" unticked; null, the default, ends it when the browser closes.
  session_seconds?: number | null;
  // How long it lasts with the box ticked; null, the default, keeps it until it is revoked or the cookie is cleared.
  remembered_seconds?: number | null;
  // How many tries one name gets from one address in the window before it waits; 5 in "5 minutes" unless set.
  tries_allowed?: number;
  try_window?: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// Browsers keep a cookie at most about this long, so a remembered one is renewed each time the page starts.
const longest_cookie_seconds = 400 * 24 * 60 * 60;

const sign_in_first = "Sign in first.";

// ── Registration ─────────────────────────────────────────────────────────────

export async function register_accounts(app: FastifyInstance, options: AccountSignInOptions): Promise<void> {
  const {
    accounts, cookie_name, oidc = null, proxy = null, needed = () => "any" as const,
    session_seconds = null, remembered_seconds = null, tries_allowed = 5, try_window = "5 minutes",
  } = options;
  const prefix = options.api_prefix ?? "/api";
  const oidc_cookie_name = `${cookie_name}_oidc`;
  const routes = {
    info: `${prefix}/auth/info`, login: `${prefix}/login`, logout: `${prefix}/logout`, me: `${prefix}/me`,
    oidc_start: `${prefix}/auth/oidc/start`, oidc_callback: `${prefix}/auth/oidc/callback`,
    account: `${prefix}/account`, users: `${prefix}/users`, tokens: `${prefix}/tokens`,
  };
  const guarded_paths = new Set(options.guarded_paths ?? []);
  const read_only_paths = new Set(options.read_only_paths ?? []);
  const open_paths = new Set([routes.info, routes.login, routes.oidc_start, routes.oidc_callback, ...(options.open_paths ?? [])]);
  const admin: Need = { role: accounts.top_role };

  await app.register(fastify_cookie);
  await app.register(fastify_rate_limit, {
    global: false,
    errorResponseBuilder: () => Object.assign(new Error("Too many tries; wait a few minutes."), { statusCode: 429 }),
  });

  app.decorateRequest("viewer", null);

  // ── Who is asking ────────────────────────────────────────────────────────

  const session_cookie = (request: FastifyRequest, remember: boolean): CookieSerializeOptions => ({
    path: "/", httpOnly: true, sameSite: "strict", secure: is_secure(request),
    ...(remember ? { maxAge: remembered_seconds ?? longest_cookie_seconds } : {}),
  });

  const identify = (request: FastifyRequest): Viewer | null => {
    const secret = request.cookies[cookie_name];
    if (secret) {
      const session = accounts.session(secret);
      const user = session === null ? null : accounts.user(session.name);
      if (session !== null && user !== null) return as_viewer(user, "session", false, session.id);
    }
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1]?.trim();
    if (bearer !== undefined) {
      const token = accounts.check_token(bearer);
      const user = token === null ? null : accounts.user(token.owner);
      if (token !== null && user !== null) return as_viewer(user, "token", token.read_only, token.id);
    }
    if (proxy !== null && proxy.trusted.has(request.ip)) {
      const header = request.headers[proxy.header.toLowerCase()];
      const user = typeof header === "string" ? accounts.user(header.trim().toLowerCase()) : null;
      if (user !== null) return as_viewer(user, "proxy", false, null);
    }
    return null;
  };

  // What a request needs, with the account routes' own needs first.
  const need_of = (method: string, path: string): Need => {
    if (open_paths.has(path)) return "open";
    if (!path.startsWith(`${prefix}/`)) return guarded_paths.has(path) ? needed(method, path) : "open";
    if (path === routes.me || path === routes.logout || path.startsWith(`${routes.account}/`)) return "any";
    if (path === routes.users || path.startsWith(`${routes.users}/`) || path === routes.tokens || path.startsWith(`${routes.tokens}/`)) return admin;
    return needed(method, path);
  };

  // Added before the guard, so the guard and the routes both see who is asking.
  app.addHook("onRequest", async (request) => {
    request.viewer = identify(request);
  });

  // Every API call needs a viewer; the page loads without one and signs in itself.
  register_sign_in_guard(app, {
    is_signed_in: (request) => request.viewer !== null, api_prefix: `${prefix}/`, login_path: null, refusal: "json", refusal_text: sign_in_first, open_paths,
  });

  app.addHook("onRequest", async (request, reply) => {
    const path = path_of(request);
    const need = need_of(request.method, path);
    const viewer = request.viewer;
    if (need === "open") return;
    // The guard answers for the API; a guarded path outside it is turned away here.
    if (viewer === null) return path.startsWith(`${prefix}/`) ? undefined : reply.code(401).send({ error: sign_in_first });
    // A token cannot manage the account that owns it, so a lost device cannot lock its owner out.
    if (viewer.via === "token" && (path.startsWith(`${routes.account}/`) || typeof need === "object" && (path.startsWith(routes.users) || path.startsWith(routes.tokens)))) {
      return reply.code(403).send({ error: "A token cannot manage accounts; sign in on the page." });
    }
    if (viewer.read_only && request.method !== "GET" && path !== routes.logout && !read_only_paths.has(path)) {
      return reply.code(403).send({ error: "This token can only read." });
    }
    if (typeof need === "object" && !accounts.has_role(viewer.role, need.role)) {
      return reply.code(403).send({ error: `This needs the ${need.role} role; ${viewer.name} is ${article(viewer.role)} ${viewer.role}.` });
    }
  });

  // The routes sit in a scope of their own, so their refusals answer in their own words without changing the app's error handler.
  await app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof AccountError) return reply.code(error.status).send({ error: error.message });
      // A refusal such as too many tries answers in its own words too.
      const status = (error as { statusCode?: number }).statusCode;
      if (status !== undefined && status >= 400 && status < 500) return reply.code(status).send({ error: (error as Error).message });
      return reply.send(error);
    });

    // ── Signing in ───────────────────────────────────────────────────────────

    const start_session = (request: FastifyRequest, reply: FastifyReply, user: User, remember: boolean) => {
      const lifetime = remember ? remembered_seconds : session_seconds;
      const { secret } = accounts.open_session(user.name, { remember, label: device_label(request.headers["user-agent"]), lifetime_in_seconds: lifetime });
      reply.setCookie(cookie_name, secret, session_cookie(request, remember));
    };

    const login_name = (request: FastifyRequest) => {
      const body = request.body as { name?: unknown } | undefined;
      return typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
    };

    scope.get(routes.info, async () => ({ app_name: accounts.app_name, oidc: oidc === null ? null : { label: oidc.settings.label, start: routes.oidc_start } }));

    // Tries are counted per name and address once the body is read, whether they succeed or not.
    scope.post<{ Body: { name?: unknown; password?: unknown; code?: unknown; remember?: unknown; device?: unknown } }>(routes.login, {
      config: { rateLimit: { max: tries_allowed, timeWindow: try_window, hook: "preHandler", keyGenerator: (request) => `${request.ip}\n${login_name(request)}` } },
    }, async (request, reply) => {
      const body = request.body ?? {};
      const code = typeof body.code === "string" ? body.code : undefined;
      const { user, needs_code } = typeof body.password === "string" ? accounts.authenticate(login_name(request), body.password, code) : { user: null, needs_code: false };
      if (user === null) {
        if (needs_code) return reply.code(401).send({ error: code ? "That code does not match." : "Enter the code from your authenticator app.", code_needed: true });
        return reply.code(401).send({ error: "Wrong name or password." });
      }
      // A device, such as the phone app syncing with this server, gets a token of its own in place of a cookie.
      if (typeof body.device === "string" && body.device.trim() !== "") {
        return reply.code(201).send(accounts.create_token(user.name, { name: body.device, read_only: false }));
      }
      start_session(request, reply, user, body.remember === true);
      return reply.code(204).send();
    });

    // Ends this session, or revokes the token the request came with.
    scope.post(routes.logout, async (request, reply) => {
      const viewer = request.viewer!;
      if (viewer.via === "session") accounts.close_session(viewer.name, viewer.credential_id!);
      if (viewer.via === "token") accounts.delete_token(viewer.credential_id!, viewer.name);
      reply.clearCookie(cookie_name, { path: "/" });
      return reply.code(204).send();
    });

    // Who is signed in; the page asks when it starts, which also renews a remembered cookie.
    scope.get(routes.me, async (request, reply) => {
      const viewer = request.viewer!;
      const user = accounts.user(viewer.name)!;
      const secret = request.cookies[cookie_name];
      const session = viewer.via === "session" && secret ? accounts.session(secret) : null;
      if (session?.remember && secret) reply.setCookie(cookie_name, secret, session_cookie(request, true));
      return {
        name: viewer.name, role: viewer.role, access: viewer.access, via: viewer.via, read_only: viewer.read_only,
        roles: accounts.roles, totp_enabled: user.totp_enabled, source: user.source, has_password: user.has_password,
      };
    });

    // ── Single sign-on ───────────────────────────────────────────────────────

    if (oidc !== null) {
      // The state goes back in a cookie too, so only the browser that started a sign-in can finish it.
      const oidc_cookie: CookieSerializeOptions = { path: "/", httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 600 };

      scope.get<{ Querystring: { remember?: string } }>(routes.oidc_start, async (request, reply) => {
        const url = await oidc.start();
        const state = new URL(url).searchParams.get("state")!;
        reply.setCookie(oidc_cookie_name, `${request.query.remember === "1" ? "1" : "0"}.${state}`, oidc_cookie);
        return reply.redirect(url);
      });

      scope.get<{ Querystring: { state?: string; code?: string; error?: string; error_description?: string } }>(routes.oidc_callback, async (request, reply) => {
        const fail = (message: string) => reply.redirect(`/#/?sign_in_error=${encodeURIComponent(message)}`);
        const { state = "", code = "", error, error_description } = request.query;
        const [remember, started_state] = (request.cookies[oidc_cookie_name] ?? "").split(".", 2);
        if (error) return fail(`The provider refused the sign-in: ${error_description ?? error}`);
        if (!state || state !== started_state) return fail("That sign-in was started in another browser; start again.");
        try {
          const name = (await oidc.finish(state, code)).toLowerCase();
          const user = accounts.user(name);
          if (user === null) return fail(`There is no ${accounts.app_name} user named '${name}'; an admin adds one first.`);
          reply.clearCookie(oidc_cookie_name, oidc_cookie);
          start_session(request, reply, user, remember === "1");
          return reply.redirect("/");
        } catch (problem) {
          return fail((problem as Error).message);
        }
      });
    }

    // ── Own account ──────────────────────────────────────────────────────────

    scope.put<{ Body: { current?: unknown; next?: unknown } }>(`${routes.account}/password`, async (request) => {
      const viewer = request.viewer!;
      accounts.change_password(viewer.name, request.body?.current, request.body?.next);
      accounts.close_sessions(viewer.name, viewer.via === "session" ? viewer.credential_id : null);
      return { ok: true };
    });

    scope.post(`${routes.account}/totp/start`, async (request) => accounts.start_totp(request.viewer!.name));

    scope.post<{ Body: { code?: unknown } }>(`${routes.account}/totp/confirm`, async (request) =>
      ({ recovery_codes: accounts.confirm_totp(request.viewer!.name, request.body?.code) }));

    scope.post<{ Body: { code?: unknown } }>(`${routes.account}/totp/disable`, async (request) => {
      accounts.disable_totp(request.viewer!.name, request.body?.code);
      return { ok: true };
    });

    scope.get(`${routes.account}/sessions`, async (request) => {
      const viewer = request.viewer!;
      return accounts.sessions(viewer.name).map((session) => ({ ...session, current: viewer.via === "session" && session.id === viewer.credential_id }));
    });

    scope.delete<{ Params: { id: string } }>(`${routes.account}/sessions/:id`, async (request, reply) => {
      accounts.close_session(request.viewer!.name, Number(request.params.id));
      return reply.code(204).send();
    });

    // Signs out everywhere else.
    scope.delete(`${routes.account}/sessions`, async (request, reply) => {
      const viewer = request.viewer!;
      accounts.close_sessions(viewer.name, viewer.via === "session" ? viewer.credential_id : null);
      return reply.code(204).send();
    });

    scope.get(`${routes.account}/tokens`, async (request) => accounts.tokens(request.viewer!.name));

    scope.post<{ Body: { name?: unknown; read_only?: unknown } }>(`${routes.account}/tokens`, async (request, reply) =>
      reply.code(201).send(accounts.create_token(request.viewer!.name, { name: request.body?.name, read_only: request.body?.read_only })));

    scope.delete<{ Params: { id: string } }>(`${routes.account}/tokens/:id`, async (request, reply) => {
      accounts.delete_token(Number(request.params.id), request.viewer!.name);
      return reply.code(204).send();
    });

    // ── Users and tokens ─────────────────────────────────────────────────────

    scope.get(routes.users, async () => accounts.users());

    scope.post<{ Body: Record<string, unknown> }>(routes.users, async (request, reply) => {
      const body = request.body ?? {};
      const user = accounts.create_user({ name: body.name, role: body.role, access: body.access, password: body.password });
      request.log.info(`${request.viewer!.name} added the user ${user.name} as ${user.role}`);
      return reply.code(201).send(user);
    });

    // A change to someone's role, access or password signs them out everywhere.
    scope.put<{ Params: { name: string }; Body: Record<string, unknown> }>(`${routes.users}/:name`, async (request) => {
      const body = request.body ?? {};
      const user = accounts.update_user(request.params.name, { role: body.role, access: body.access, password: body.password });
      accounts.close_sessions(user.name);
      request.log.info(`${request.viewer!.name} changed the user ${user.name}`);
      return user;
    });

    scope.delete<{ Params: { name: string } }>(`${routes.users}/:name`, async (request, reply) => {
      if (request.params.name === request.viewer!.name) throw new AccountError("You cannot remove yourself.", 403);
      accounts.delete_user(request.params.name);
      request.log.info(`${request.viewer!.name} removed the user ${request.params.name}`);
      return reply.code(204).send();
    });

    scope.post<{ Params: { name: string } }>(`${routes.users}/:name/totp/reset`, async (request) => {
      if (accounts.user(request.params.name) === null) throw new AccountError(`No user named '${request.params.name}'.`, 404);
      accounts.reset_totp(request.params.name);
      request.log.info(`${request.viewer!.name} reset the second factor of ${request.params.name}`);
      return { ok: true };
    });

    scope.delete<{ Params: { name: string } }>(`${routes.users}/:name/sessions`, async (request, reply) => {
      if (accounts.user(request.params.name) === null) throw new AccountError(`No user named '${request.params.name}'.`, 404);
      accounts.close_sessions(request.params.name);
      request.log.info(`${request.viewer!.name} signed ${request.params.name} out everywhere`);
      return reply.code(204).send();
    });

    scope.get(routes.tokens, async () => accounts.tokens());

    scope.delete<{ Params: { id: string } }>(`${routes.tokens}/:id`, async (request, reply) => {
      accounts.delete_token(Number(request.params.id));
      return reply.code(204).send();
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function as_viewer(user: User, via: Viewer["via"], read_only: boolean, credential_id: number | null): Viewer {
  return { name: user.name, role: user.role, access: user.access, via, read_only, credential_id };
}

// A proxy that ends TLS says so in a header, and the cookie is then kept to secure connections.
function is_secure(request: FastifyRequest): boolean {
  return request.headers["x-forwarded-proto"] === "https" || "encrypted" in request.raw.socket;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

// The browser and system a user agent names, such as "Firefox on Linux", for the list of sessions.
export function device_label(user_agent: string | undefined): string {
  const agent = user_agent ?? "";
  const browser = [["Electron/", "the desktop app"], ["Edg/", "Edge"], ["OPR/", "Opera"], ["Firefox/", "Firefox"], ["Chrome/", "Chrome"], ["Safari/", "Safari"]]
    .find(([marker]) => agent.includes(marker!))?.[1];
  const system = [["Android", "Android"], ["iPhone", "iPhone"], ["iPad", "iPad"], ["Windows", "Windows"], ["Mac OS", "macOS"], ["CrOS", "ChromeOS"], ["Linux", "Linux"]]
    .find(([marker]) => agent.includes(marker!))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}
