import { DatabaseSync } from "node:sqlite";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { register_accounts, type AccountSignInOptions } from "../../src/server/account_sign_in.ts";
import { AccountError, AccountStore, digest } from "../../src/server/account_store.ts";
import { default_largest_pref_bytes, read_account_pref, write_account_pref, type AccountPrefsOptions } from "../../src/server/account_prefs.ts";
import type { DeclaredToken } from "../../src/server/declared_tokens.ts";
import { hash_password } from "../../src/server/passwords.ts";

const password = "a long enough password";
let app: FastifyInstance;

afterEach(() => app?.close());

// Dashboards are a list of names, and a theme is "light" or "dark".
const prefs: AccountPrefsOptions = {
  keys: {
    dashboards: (value) => {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new AccountError("Dashboards are a list of names.");
      return value.map((item: string) => item.trim());
    },
    theme: (value) => {
      if (value !== "light" && value !== "dark") throw new Error("pick light or dark");
      return value;
    },
  },
};

function store(declared_tokens: DeclaredToken[] = []): AccountStore {
  return new AccountStore({
    database: new DatabaseSync(":memory:"), app_name: "X-Test", roles: ["viewer", "admin"],
    declared: new Map([["root", hash_password(password)]]), declared_tokens,
  });
}

async function serve(accounts: AccountStore, options: Partial<AccountSignInOptions> = {}): Promise<void> {
  app = Fastify();
  await register_accounts(app, {
    accounts, cookie_name: "x_test_session", prefs,
    needed: (method) => (method === "GET" ? "any" : { role: "admin" }),
    ...options,
  });
}

async function session_of(name: string): Promise<{ x_test_session: string }> {
  const response = await app.inject({ method: "POST", url: "/api/login", payload: { name, password } });
  return { x_test_session: response.cookies.find((cookie) => cookie.name === "x_test_session")!.value };
}

// ============================================================================
// Store
// ============================================================================

describe("account preferences in the store", () => {
  it("keeps one value per user and key, cleaned by its check, and reads it back", () => {
    const accounts = store();
    const written = write_account_pref(accounts, prefs, "root", "dashboards", [" Hosts ", "Jobs"]);

    expect(written).toEqual({ key: "dashboards", value: ["Hosts", "Jobs"], changed_epoch: expect.any(Number) });
    expect(read_account_pref(accounts, prefs, "root", "dashboards")).toEqual(written);
    expect(read_account_pref(accounts, prefs, "other", "dashboards")).toEqual({ key: "dashboards", value: null, changed_epoch: null });
  });

  it("refuses an unknown key, a value its check refuses and one too large", () => {
    const accounts = store();
    const small = { keys: { notes: (value: unknown) => value }, largest_bytes: 10 };

    expect(() => read_account_pref(accounts, prefs, "root", "constructor")).toThrow("No preference named 'constructor'.");
    expect(() => write_account_pref(accounts, prefs, "root", "dashboards", "Hosts")).toThrow("Dashboards are a list of names.");
    expect(() => write_account_pref(accounts, prefs, "root", "theme", "pink")).toThrow("The preference 'theme' is not valid: pick light or dark");
    expect(() => write_account_pref(accounts, small, "root", "notes", "far more than ten bytes")).toThrow("may take at most 10 bytes");
    expect(() => write_account_pref(accounts, small, "root", "notes", undefined)).toThrow("has no value to keep");
    expect(default_largest_pref_bytes).toBe(256 * 1024);
  });

  it("reads a stored value that no longer passes its check as none", () => {
    const accounts = store();
    accounts.set_pref("root", "theme", "\"sepia\"");
    accounts.set_pref("root", "dashboards", "not json{");

    expect(read_account_pref(accounts, prefs, "root", "theme").value).toBeNull();
    expect(read_account_pref(accounts, prefs, "root", "dashboards").changed_epoch).toBeNull();
  });

  it("removes a user's preferences with the user", () => {
    const accounts = store();
    accounts.create_user({ name: "vera", role: "viewer", access: null, password });
    accounts.set_pref("vera", "theme", "\"dark\"");

    accounts.delete_user("vera");
    accounts.create_user({ name: "vera", role: "viewer", access: null, password });

    expect(accounts.pref("vera", "theme")).toBeNull();
  });
});

// ============================================================================
// Routes
// ============================================================================

describe("account preference routes", () => {
  it("let any signed-in user read and write only their own", async () => {
    const accounts = store();
    accounts.create_user({ name: "vera", role: "viewer", access: null, password });
    await serve(accounts);
    const vera = await session_of("vera");
    const root = await session_of("root");

    const put = await app.inject({ method: "PUT", url: "/api/account/prefs/theme", cookies: vera, payload: { value: "dark" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: "theme", value: "dark" });

    expect((await app.inject({ url: "/api/account/prefs/theme", cookies: vera })).json()).toMatchObject({ value: "dark" });
    expect((await app.inject({ url: "/api/account/prefs/theme", cookies: root })).json()).toEqual({ key: "theme", value: null, changed_epoch: null });
  });

  it("refuse nobody signed in, an unknown key, a bad value and a body without one", async () => {
    await serve(store());
    const root = await session_of("root");

    expect((await app.inject({ url: "/api/account/prefs/theme" })).statusCode).toBe(401);
    const unknown = await app.inject({ url: "/api/account/prefs/colour", cookies: root });
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: "No preference named 'colour'." }]);
    const bad = await app.inject({ method: "PUT", url: "/api/account/prefs/dashboards", cookies: root, payload: { value: 3 } });
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: "Dashboards are a list of names." }]);
    const empty = await app.inject({ method: "PUT", url: "/api/account/prefs/dashboards", cookies: root, payload: {} });
    expect(empty.json()).toEqual({ error: "Send the preference as { value }." });
  });

  it("refuse a value past the app's limit, and a body far past it before reading it", async () => {
    await serve(store(), { prefs: { keys: { notes: (value) => value }, largest_bytes: 2048 } });
    const root = await session_of("root");

    const large = await app.inject({ method: "PUT", url: "/api/account/prefs/notes", cookies: root, payload: { value: "x".repeat(3000) } });
    expect([large.statusCode, large.json()]).toEqual([413, { error: "The preference 'notes' may take at most 2 KB." }]);
    const huge = await app.inject({ method: "PUT", url: "/api/account/prefs/notes", cookies: root, payload: { value: "x".repeat(10000) } });
    expect(huge.statusCode).toBe(413);
  });

  it("let a full token read and write, a read-only one only read, and a config token neither", async () => {
    const config_secret = "a token from the config file";
    const accounts = store([{ name: "deploy", digest: digest(config_secret), scope: "admin", role: "admin", read_only: false, limited_to: null }]);
    const config = { authorization: `Bearer ${config_secret}` };
    await serve(accounts);
    const full = { authorization: `Bearer ${accounts.create_token("root", { name: "laptop", read_only: false, kind: "device" }).token}` };
    const reader = { authorization: `Bearer ${accounts.create_token("root", { name: "script", read_only: true }).token}` };

    expect((await app.inject({ method: "PUT", url: "/api/account/prefs/theme", headers: full, payload: { value: "light" } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/account/prefs/theme", headers: reader })).json()).toMatchObject({ value: "light" });
    const refused = await app.inject({ method: "PUT", url: "/api/account/prefs/theme", headers: reader, payload: { value: "dark" } });
    expect([refused.statusCode, refused.json()]).toEqual([403, { error: "This token can only read." }]);
    expect((await app.inject({ url: "/api/account/sessions", headers: full })).statusCode).toBe(403);
    const declared = await app.inject({ method: "PUT", url: "/api/account/prefs/theme", headers: config, payload: { value: "dark" } });
    expect([declared.statusCode, declared.json()]).toEqual([403, { error: "A token from the config has no account to keep preferences in." }]);
  });

  it("leave the account routes to tokens closed when no preferences are given", async () => {
    const accounts = store();
    await serve(accounts, { prefs: null });
    const full = { authorization: `Bearer ${accounts.create_token("root", { name: "laptop", read_only: false, kind: "device" }).token}` };

    expect((await app.inject({ url: "/api/account/prefs/theme", headers: full })).statusCode).toBe(403);
  });
});
