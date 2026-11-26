import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, expect, test } from "vitest";

import { ItemCallMissing, checked_item_address, forget_item_prefixes, item_client, type ItemApp } from "../src/item_client.ts";
import { item_calls, type ItemFields, type ItemSource } from "../src/items.ts";
import { register_call_table } from "../src/server/call_table.ts";

const servers: FastifyInstance[] = [];

beforeEach(() => forget_item_prefixes());
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const token = ["test", "token", String(Math.random())].join("-");

const task = (id: string, extra: Partial<ItemFields> = {}): ItemFields => ({ id, kind: "task", title: `Task ${id}`, changed_at: "2026-11-01T00:00:00.000Z", ...extra });

const notes: Record<string, string> = { a: "# Plan\n\nBuy milk.", b: "", c: "é".repeat(200_000) };

function tasks(with_text: boolean): ItemSource {
  return {
    kinds: [{ kind: "task", label: "Task", has_text: true }],
    search: (query) => [task("a", { snippet: query })],
    get: (ids) => ids.filter((id) => id in notes).map((id) => task(id)),
    changes: () => [task("a"), { id: "gone", kind: "task", is_deleted: true, changed_at: "2026-11-02T00:00:00.000Z" }],
    ...(with_text ? { text: (ids: string[]) => ids.filter((id) => id in notes).map((id) => ({ id, text: notes[id]!, format: "markdown" as const, changed_at: "2026-11-01T00:00:00.000Z" })) } : {}),
  };
}

// An app answering the item calls on a random port, at the standard path or the older one, behind a bearer token.
async function serve(options: { with_text?: boolean; path?: string; answer_token?: string } = {}): Promise<ItemApp> {
  const server = Fastify();
  servers.push(server);
  server.addHook("onRequest", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${options.answer_token ?? token}`) return reply.code(401).send("no");
  });
  const { methods } = item_calls(tasks(options.with_text ?? true), { scheme: "x-tasks" });
  register_call_table(server, options.path ?? "/api/call", methods, { is_read_only: () => true });
  const address = await server.listen({ port: 0, host: "127.0.0.1" });
  return { name: "X-Tasks", address: `${address}/`, token };
}

test("the four calls and the text call read an app at the standard path", async () => {
  const client = item_client(await serve());
  expect(await client.list_item_kinds()).toEqual([{ kind: "task", label: "Task", has_text: true }]);
  expect((await client.search_items("milk", 5))[0]).toMatchObject({ id: "a", snippet: "milk", link: "x-tasks://task/a" });
  expect((await client.get_items(["a", "nope"])).map((item) => item.id)).toEqual(["a"]);
  expect((await client.list_item_changes(null, 10)).map((change) => change.id)).toEqual(["a", "gone"]);

  const texts = await client.get_item_texts(["a", "b", "c", "nope"]);
  expect(texts!.map((each) => each.id)).toEqual(["a", "c"]);
  expect(texts![0]).toEqual({ id: "a", text: notes.a, format: "markdown", changed_at: "2026-11-01T00:00:00.000Z", is_truncated: false });
  expect(texts![1]!.is_truncated).toBe(true);
});

test("an app without the text call gives null for texts and kinds without text", async () => {
  const client = item_client(await serve({ with_text: false }));
  expect(await client.list_item_kinds()).toEqual([{ kind: "task", label: "Task", has_text: false }]);
  expect(await client.get_item_texts(["a"])).toBeNull();
  await expect(client.call("get_item_texts", [["a"]])).rejects.toBeInstanceOf(ItemCallMissing);
});

test("an app on the older path is read there, and ids go a page at a time", async () => {
  const app = await serve({ path: "/api" });
  const seen: string[] = [];
  const counting: typeof fetch = (input, init) => (seen.push(String(input)), fetch(input, init));
  const client = item_client(app, { page_size: 1, fetch: counting });
  expect((await client.get_items(["a", "c"])).map((item) => item.id)).toEqual(["a", "c"]);
  expect(seen.map((url) => new URL(url).pathname)).toEqual(["/api/call/get_items", "/api/get_items", "/api/get_items"]);
});

test("failures are put in plain words without the token", async () => {
  const refused = await serve({ answer_token: "another" });
  await expect(item_client(refused).list_item_kinds()).rejects.toThrow("refused the token");
  await expect(item_client({ ...refused, address: "ftp://example.org" }).list_item_kinds()).rejects.toThrow("starts with https://");
  await expect(item_client({ ...refused, address: "not an address" }).list_item_kinds()).rejects.toThrow("Give the app's address");
  const closed = await serve();
  await servers.pop()!.close();
  const error = await item_client(closed, { wait_ms: 2000 }).list_item_kinds().catch((caught: Error) => caught);
  expect(String(error)).toContain("Could not reach X-Tasks");
  expect(String(error)).not.toContain(token);
  expect(checked_item_address(" https://tasks.example.org// ")).toBe("https://tasks.example.org");
});

test("an answer that is not a list or not JSON is refused", async () => {
  const server = Fastify();
  servers.push(server);
  server.post("/api/call/list_item_kinds", async () => ({ not: "a list" }));
  server.post("/api/call/search_items", async (_request, reply) => reply.type("text/html").send("<html>"));
  server.post("/api/call/get_items", async (_request, reply) => reply.code(500).send("broken"));
  server.post("/api/get_items", async (_request, reply) => reply.code(500).send("broken"));
  server.post("/api/call/list_item_changes", async (_request, reply) => reply.code(403).send("no"));
  server.post("/api/list_item_changes", async (_request, reply) => reply.code(404).send("no"));
  const address = await server.listen({ port: 0, host: "127.0.0.1" });
  const client = item_client({ name: "Odd", address, token: "" });
  await expect(client.list_item_kinds()).rejects.toThrow("gave no list");
  await expect(client.search_items("a", 1)).rejects.toThrow("gave no JSON");
  await expect(client.get_items(["a"])).rejects.toThrow("could not answer get_items (500: broken)");
  await expect(client.list_item_changes(null, 1)).rejects.toThrow("refused the token for list_item_changes");
});
