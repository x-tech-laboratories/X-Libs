import { DatabaseSync } from "node:sqlite";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { MethodSpec } from "../../src/api_spec.ts";
import { calls_under, register_accounts, token_refusal } from "../../src/server/account_sign_in.ts";
import { AccountError, AccountStore, type TokenScope } from "../../src/server/account_store.ts";
import { register_call_table } from "../../src/server/call_table.ts";
import { register_mcp_route } from "../../src/server/mcp.ts";
import { hash_password } from "../../src/server/passwords.ts";

const password = "a long enough password";
const protocol_version = "2025-06-18";

const token_scopes: Record<string, TokenScope> = {
  add_items: { label: "Add items", hint: "Reads, and adds items.", calls: ["add_item"] },
  tidy: { label: "Tidy", calls: ["delete_item"] },
};

const api: Record<string, MethodSpec> = {
  list_items: { description: "Lists the items.", params: [] },
  add_item: { description: "Adds an item.", params: [{ name: "title", schema: { type: "string" } }] },
  delete_item: { description: "Deletes an item.", params: [{ name: "title", schema: { type: "string" } }], destructive: true },
};

const is_read_only = (call: string) => call.startsWith("list_");

let app: FastifyInstance;
let items: string[];

afterEach(() => app?.close());

function store(scopes: Record<string, TokenScope> | null = token_scopes): AccountStore {
  return new AccountStore({
    database: new DatabaseSync(":memory:"),
    app_name: "X-Test",
    declared: new Map([["root", hash_password(password)]]),
    ...(scopes === null ? {} : { token_scopes: scopes }),
  });
}

// An app with a call table and MCP behind the standard sign-in, as X-Dev serves them.
async function serve(): Promise<AccountStore> {
  const accounts = store();
  items = ["milk"];
  const methods = {
    list_items: () => items,
    add_item: (title: string) => void items.push(title),
    delete_item: (title: string) => void (items = items.filter((item) => item !== title)),
  };
  app = Fastify();
  await register_accounts(app, { accounts, cookie_name: "x_test_session", read_only_paths: ["/api/mcp"], call_of: calls_under("/api/call"), is_read_only });
  await app.register(async (scope) => {
    register_call_table(scope, "/call", methods, { is_read_only });
    await register_mcp_route(scope, {
      name: "items", version: "1.0.0", api, is_read_only,
      call: (method, args) => (methods as Record<string, (...args: unknown[]) => unknown>)[method]!(...args),
    });
  }, { prefix: "/api" });
  app.post("/api/things", async () => ({ ok: true }));
  return accounts;
}

function call(token: string, method: string, args: unknown[] = []) {
  return app.inject({ method: "POST", url: `/api/call/${method}`, headers: { authorization: `Bearer ${token}` }, payload: args });
}

async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ isError?: boolean; content: { text: string }[] }> {
  const reply = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocol_version, authorization: `Bearer ${token}` },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(reply.statusCode).toBe(200);
  const data = reply.headers["content-type"]?.includes("text/event-stream") ? /^data: (.+)$/m.exec(reply.body)![1]! : reply.body;
  return (JSON.parse(data) as { result: { isError?: boolean; content: { text: string }[] } }).result;
}

describe("token scopes in the store", () => {
  it("keep a scoped token read-only with its scope, and refuse a scope the app does not offer", () => {
    const accounts = store();
    accounts.create_user({ name: "vera", role: "admin", access: null, password });
    const { token } = accounts.create_token("vera", { name: "adder", read_only: false, scope: "add_items" });

    expect(accounts.check_token(token)).toMatchObject({ read_only: true, scope: "add_items" });
    expect(() => accounts.create_token("vera", { name: "odd", read_only: true, scope: "everything" })).toThrow(AccountError);
    expect(accounts.token_scopes).toEqual([
      { id: "add_items", label: "Add items", hint: "Reads, and adds items.", calls: ["add_item"] },
      { id: "tidy", label: "Tidy", hint: "", calls: ["delete_item"] },
    ]);
    expect(accounts.token_scope(null)).toBeNull();
    expect(accounts.token_scope("gone")).toBeNull();
    expect(accounts.token_scope("tidy")?.label).toBe("Tidy");
  });

  it("make full and read-only tokens as before when the app offers none", () => {
    const accounts = store(null);
    accounts.create_user({ name: "vera", role: "admin", access: null, password });
    const full = accounts.create_token("vera", { name: "full", read_only: false, scope: "" });
    const reader = accounts.create_token("vera", { name: "reader", read_only: true });

    expect(accounts.check_token(full.token)).toMatchObject({ read_only: false, scope: null });
    expect(accounts.check_token(reader.token)).toMatchObject({ read_only: true, scope: null });
    expect(accounts.token_scopes).toEqual([]);
  });
});

describe("calls_under", () => {
  it("names the call a path under a prefix makes, and nothing else", () => {
    const of = calls_under("/api/call", "/api/stages/");
    expect(of("POST", "/api/call/add_item")).toBe("add_item");
    expect(of("POST", "/api/stages/save_stage")).toBe("save_stage");
    expect(of("POST", "/api/call/add_item/more")).toBeNull();
    expect(of("POST", "/api/things")).toBeNull();
  });

  it("words a refusal by the token's scope", () => {
    expect(token_refusal({}, "add_item")).toBe("This token can only read.");
    expect(token_refusal({ scope: { id: "tidy", label: "Tidy", hint: "", calls: [] } }, null)).toBe("This token is kept to Tidy.");
  });
});

describe("a scoped token", () => {
  it("reads and makes its scope's calls on the API, and is refused the rest", async () => {
    const accounts = await serve();
    accounts.create_user({ name: "vera", role: "admin", access: null, password });
    const { token } = accounts.create_token("vera", { name: "adder", read_only: false, scope: "add_items" });

    expect((await call(token, "list_items")).json()).toEqual(["milk"]);
    expect((await call(token, "add_item", ["eggs"])).statusCode).toBe(204);
    const refused = await call(token, "delete_item", ["milk"]);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: "This token is kept to Add items, which does not include delete_item." });
    expect((await app.inject({ method: "POST", url: "/api/things", headers: { authorization: `Bearer ${token}` } })).json()).toEqual({ error: "This token is kept to Add items." });
    expect(items).toEqual(["milk", "eggs"]);
  });

  it("does the same over MCP", async () => {
    const accounts = await serve();
    accounts.create_user({ name: "vera", role: "admin", access: null, password });
    const { token } = accounts.create_token("vera", { name: "adder", read_only: false, scope: "add_items" });

    expect((await tool(token, "list_items")).content[0]!.text).toBe('["milk"]');
    expect((await tool(token, "add_item", { title: "eggs" })).isError).toBeUndefined();
    const refused = await tool(token, "delete_item", { title: "milk" });
    expect(refused).toEqual({ isError: true, content: [{ type: "text", text: "This token is kept to Add items, which does not include delete_item." }] });
    expect(items).toEqual(["milk", "eggs"]);
  });

  it("leaves a read-only token to the calls that read, and a full token to everything", async () => {
    const accounts = await serve();
    accounts.create_user({ name: "vera", role: "admin", access: null, password });
    const reader = accounts.create_token("vera", { name: "reader", read_only: true });
    const full = accounts.create_token("vera", { name: "full", read_only: false });

    expect((await call(reader.token, "list_items")).statusCode).toBe(200);
    expect((await call(reader.token, "add_item", ["eggs"])).json()).toEqual({ error: "This token can only read." });
    expect((await tool(reader.token, "add_item", { title: "eggs" })).content[0]!.text).toBe("This token can only read.");
    expect((await call(full.token, "delete_item", ["milk"])).statusCode).toBe(204);
    expect((await tool(full.token, "add_item", { title: "tea" })).isError).toBeUndefined();
    expect(items).toEqual(["tea"]);
  });
});

describe("the token routes", () => {
  it("list the scopes, make a scoped token and say which scope a token has", async () => {
    await serve();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { name: "root", password } });
    const cookie = login.cookies.find((one) => one.name === "x_test_session")!;
    const cookies = { x_test_session: cookie.value };

    expect((await app.inject({ url: "/api/account/token_scopes", cookies })).json()).toHaveLength(2);
    const made = await app.inject({ method: "POST", url: "/api/account/tokens", cookies, payload: { name: "adder", read_only: false, scope: "add_items" } });
    expect(made.statusCode).toBe(201);
    const { token } = made.json() as { token: string };
    expect((await app.inject({ url: "/api/account/tokens", cookies })).json()).toMatchObject([{ name: "adder", read_only: true, scope: "add_items" }]);
    expect((await app.inject({ url: "/api/me", headers: { authorization: `Bearer ${token}` } })).json()).toMatchObject({ read_only: true, scope: "add_items" });
    expect((await app.inject({ url: "/api/me", cookies })).json()).toMatchObject({ scope: null });
  });
});
