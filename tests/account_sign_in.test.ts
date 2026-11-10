import { DatabaseSync } from "node:sqlite";

import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { register_accounts, device_label, type AccountSignInOptions } from "../src/server/account_sign_in.ts";
import { AccountStore } from "../src/server/account_store.ts";
import { hash_password } from "../src/server/passwords.ts";
import { code_at } from "../src/server/totp.ts";

const password = "a long enough password";
let app: FastifyInstance;

afterEach(() => app?.close());

async function serve(options: Partial<AccountSignInOptions> = {}): Promise<AccountStore> {
  const accounts = new AccountStore({
    database: new DatabaseSync(":memory:"),
    app_name: "X-Test",
    roles: ["viewer", "operator", "admin"],
    declared: new Map([["root", hash_password(password)]]),
  });
  app = Fastify();
  await register_accounts(app, {
    accounts, cookie_name: "x_test_session",
    needed: (method) => method === "POST" ? { role: "operator" } : "any",
    ...options,
  });
  app.get("/api/things", async (request) => ({ seen_by: request.viewer?.name }));
  app.post("/api/things", async () => ({ ok: true }));
  app.get("/", async () => "page");
  app.get("/metrics", async () => "metrics");
  return accounts;
}

async function sign_in(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return app.inject({ method: "POST", url: "/api/login", payload: body });
}

function cookie_of(response: LightMyRequestResponse) {
  return response.cookies.find((cookie) => cookie.name === "x_test_session")!;
}

describe("signing in", () => {
  it("opens a session that ends with the browser unless kept", async () => {
    await serve();

    const response = await sign_in({ name: "Root", password });
    const cookie = cookie_of(response);

    expect(response.statusCode).toBe(204);
    expect(cookie.maxAge).toBeUndefined();
    const things = await app.inject({ url: "/api/things", cookies: { x_test_session: cookie.value } });
    expect(things.json()).toEqual({ seen_by: "root" });
  });

  it("keeps a ticked session in a lasting cookie, bounded when asked", async () => {
    await serve({ remembered_seconds: 3600 });

    const cookie = cookie_of(await sign_in({ name: "root", password, remember: true }));

    expect(cookie.maxAge).toBe(3600);
  });

  it("refuses a wrong password and API calls without a session, but leaves the page open", async () => {
    await serve();

    expect((await sign_in({ name: "root", password: "wrong" })).json()).toEqual({ error: "Wrong name or password." });
    expect((await app.inject({ url: "/api/things" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/" })).body).toBe("page");
  });

  it("makes a name wait after five wrong tries from one address", async () => {
    await serve();

    for (let attempt = 0; attempt < 5; attempt++) await sign_in({ name: "root", password: "wrong" });
    const locked = await sign_in({ name: "root", password });

    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: "Too many tries; wait a few minutes." });
  });

  it("asks for the second factor once the password is right", async () => {
    const accounts = await serve();
    const { secret } = accounts.start_totp("root");
    accounts.confirm_totp("root", code_at(secret, Date.now() / 1000));

    const without = await sign_in({ name: "root", password });
    const with_code = await sign_in({ name: "root", password, code: code_at(secret, Date.now() / 1000 + 30) });

    expect(without.json()).toEqual({ error: "Enter the code from your authenticator app.", code_needed: true });
    expect(with_code.statusCode).toBe(204);
  });

  it("hands a device a token that acts as its user until it signs out", async () => {
    await serve();

    const { token } = (await sign_in({ name: "root", password, device: "Phone" })).json();
    const headers = { authorization: `Bearer ${token}` };

    expect((await app.inject({ method: "POST", url: "/api/things", headers })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "PUT", url: "/api/account/password", headers, payload: {} })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: "/api/logout", headers });
    expect((await app.inject({ url: "/api/things", headers })).statusCode).toBe(401);
  });
});

describe("guarded paths", () => {
  it("guards a path outside the API only when it is named", async () => {
    await serve({ guarded_paths: ["/metrics"] });
    const { token } = (await sign_in({ name: "root", password, device: "Scraper" })).json();

    expect((await app.inject({ url: "/metrics" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/metrics", headers: { authorization: `Bearer ${token}` } })).body).toBe("metrics");
    expect((await app.inject({ url: "/" })).body).toBe("page");
  });
});

describe("roles and sessions", () => {
  it("checks the role each route needs", async () => {
    const accounts = await serve();
    accounts.create_user({ name: "vera", role: "viewer", access: null, password });
    const { value } = cookie_of(await sign_in({ name: "vera", password }));
    const cookies = { x_test_session: value };

    expect((await app.inject({ url: "/api/things", cookies })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/things", cookies })).json()).toEqual({ error: "This needs the operator role; vera is a viewer." });
    expect((await app.inject({ url: "/api/users", cookies })).statusCode).toBe(403);
  });

  it("lists the user's sessions and signs out the others", async () => {
    await serve();
    const first = cookie_of(await sign_in({ name: "root", password })).value;
    const second = cookie_of(await sign_in({ name: "root", password, remember: true })).value;

    const listed = (await app.inject({ url: "/api/account/sessions", cookies: { x_test_session: first } })).json();
    await app.inject({ method: "DELETE", url: "/api/account/sessions", cookies: { x_test_session: first } });

    expect(listed.map((session: { remember: boolean; current: boolean }) => [session.remember, session.current]).sort()).toEqual([[false, true], [true, false]]);
    expect((await app.inject({ url: "/api/things", cookies: { x_test_session: second } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/things", cookies: { x_test_session: first } })).statusCode).toBe(200);
  });

  it("signs a user out everywhere when an admin changes them", async () => {
    const accounts = await serve();
    accounts.create_user({ name: "vera", role: "viewer", access: null, password });
    const vera = cookie_of(await sign_in({ name: "vera", password })).value;
    const root = cookie_of(await sign_in({ name: "root", password })).value;

    await app.inject({ method: "PUT", url: "/api/users/vera", cookies: { x_test_session: root }, payload: { role: "operator" } });

    expect((await app.inject({ url: "/api/things", cookies: { x_test_session: vera } })).statusCode).toBe(401);
  });

  it("answers the store's refusals in its own words", async () => {
    await serve();
    const root = cookie_of(await sign_in({ name: "root", password })).value;

    const response = await app.inject({ method: "PUT", url: "/api/users/root", cookies: { x_test_session: root }, payload: { role: "viewer" } });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("accounts file");
  });
});

describe("the store", () => {
  const store = () => new AccountStore({
    database: new DatabaseSync(":memory:"), app_name: "X-Test", roles: ["viewer", "admin"], declared: new Map([["root", hash_password(password)]]),
  });

  it("takes each code once, and each recovery code once", () => {
    const accounts = store();
    const { secret } = accounts.start_totp("root");
    const now = Date.now() / 1000;
    const recovery = accounts.confirm_totp("root", code_at(secret, now));

    expect(accounts.authenticate("root", password, undefined)).toEqual({ user: null, needs_code: true });
    expect(accounts.authenticate("root", password, code_at(secret, now)).user).toBeNull();
    expect(accounts.authenticate("root", password, code_at(secret, now + 30)).user).not.toBeNull();
    expect(accounts.authenticate("root", password, recovery[0]).user).not.toBeNull();
    expect(accounts.authenticate("root", password, recovery[0]).user).toBeNull();
  });

  it("leaves a declared user's role and password to the accounts file", () => {
    const accounts = store();

    expect(() => accounts.update_user("root", { role: "viewer" })).toThrow("accounts file");
    expect(() => accounts.delete_user("root")).toThrow("accounts file");
    expect(() => accounts.change_password("root", password, "another long password")).toThrow("accounts file");
  });

  it("keeps only a token's digest, and drops a user's tokens and sessions with them", () => {
    const accounts = store();
    accounts.create_user({ name: "vera", role: "viewer", access: null, password });
    const { token } = accounts.create_token("vera", { name: "script", read_only: true });
    const { secret } = accounts.open_session("vera", { remember: true, label: "test", lifetime_in_seconds: null });

    expect(accounts.check_token(token)).toMatchObject({ owner: "vera", read_only: true });
    accounts.delete_user("vera");
    expect(accounts.check_token(token)).toBeNull();
    expect(accounts.session(secret)).toBeNull();
  });

  it("ends sessions past their lifetime", () => {
    const accounts = new AccountStore({ database: new DatabaseSync(":memory:"), app_name: "X-Test", declared: new Map([["root", hash_password(password)]]) });

    const { secret } = accounts.open_session("root", { remember: false, label: "test", lifetime_in_seconds: -1 });

    expect(accounts.session(secret)).toBeNull();
  });

  it("accepts only the access rules the app's check passes", () => {
    const accounts = new AccountStore({
      database: new DatabaseSync(":memory:"), app_name: "X-Test",
      check_access: (value) => { if (value !== null && !Array.isArray(value)) throw new Error("a list"); return value; },
    });

    expect(accounts.create_user({ name: "ada", role: "user", access: ["one"], password }).access).toEqual(["one"]);
    expect(() => accounts.create_user({ name: "bea", role: "user", access: "one", password })).toThrow("a list");
  });
});

describe("device labels", () => {
  it("names the browser and system", () => {
    expect(device_label("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Linux");
    expect(device_label("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(device_label(undefined)).toBe("Unknown browser");
  });
});
