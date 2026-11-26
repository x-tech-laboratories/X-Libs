import { DatabaseSync } from "node:sqlite";
import fc from "fast-check";
import { afterEach, expect, test, vi } from "vitest";

import { input_schema, positional_args } from "../src/api_spec.ts";
import { create_history } from "../src/history.ts";
import {
  clip_item_text,
  clip_snippet,
  history_item_changes,
  item_calls,
  item_link,
  item_method_names,
  item_text_max_bytes,
  item_text_method_name,
  parse_item_link,
  type ItemFields,
  type ItemSource,
} from "../src/items.ts";
import type { SqlDatabase } from "../src/sql.ts";

afterEach(() => vi.useRealTimers());

// ── Links ────────────────────────────────────────────────────────────────────

test("an item link names the scheme, kind and percent-encoded id", () => {
  expect(item_link("x-tasks", "task", "a1")).toBe("x-tasks://task/a1");
  expect(item_link("codex", "note", "notes/2026:11 plan")).toBe("codex://note/notes%2F2026%3A11%20plan");
  expect(parse_item_link("codex://note/notes%2F2026%3A11%20plan")).toEqual({ scheme: "codex", kind: "note", id: "notes/2026:11 plan" });
});

test("any id reads back whole from its link", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), (id) => {
      expect(parse_item_link(item_link("x-media-tracker", "book_collection", id), "x-media-tracker")).toEqual({ scheme: "x-media-tracker", kind: "book_collection", id });
    }),
  );
});

test("a link of another app, or not an item link, reads as null", () => {
  expect(parse_item_link("x-tasks://task/a1", "x-music")).toBeNull();
  expect(parse_item_link("X-Tasks://task/a1", "x-tasks")).toEqual({ scheme: "X-Tasks", kind: "task", id: "a1" });
  expect(parse_item_link("https://example.org/a")).toBeNull();
  expect(parse_item_link("x-tasks://task/a/b")).toBeNull();
  expect(parse_item_link("x-tasks://task/")).toBeNull();
  expect(parse_item_link("x-tasks:task/a1")).toBeNull();
  expect(parse_item_link("x-tasks://task/%E0%A4%A")).toBeNull();
});

test("a link refuses a scheme, kind or id it cannot carry", () => {
  expect(() => item_link("x tasks", "task", "a")).toThrow("not a link scheme");
  expect(() => item_link("x-tasks", "a/b", "a")).toThrow("not an item kind");
  expect(() => item_link("x-tasks", "task", "")).toThrow("needs an id");
});

// ── Snippets ─────────────────────────────────────────────────────────────────

test("a snippet is one line of at most 200 characters, never splitting one", () => {
  expect(clip_snippet("  two\n\nlines  ")).toBe("two lines");
  const long = clip_snippet("😀".repeat(300));
  expect(Array.from(long)).toHaveLength(200);
  expect(long.endsWith("😀…")).toBe(true);
  expect(clip_snippet("x".repeat(200))).toHaveLength(200);
});

// ── Calls ────────────────────────────────────────────────────────────────────

const task = (id: string, changed_at: string, extra: Partial<ItemFields> = {}): ItemFields => ({ id, kind: "task", title: `Task ${id}`, changed_at, ...extra });

function source(overrides: Partial<ItemSource> = {}): ItemSource {
  return {
    kinds: [{ kind: "task", label: "Task" }],
    search: (query, limit) => [task("a", "2026-11-01T00:00:00.000Z", { snippet: `matches ${query}`, status: "done", detail: { due: "today" } }), task("b", "2026-11-02T00:00:00.000Z")].slice(0, limit + 1),
    get: (ids) => [...ids, "stranger"].filter((id) => id !== "gone").map((id) => task(id, "2026-11-01T00:00:00.000Z")),
    changes: () => [],
    ...overrides,
  };
}

test("the four calls are named as read-only calls are, and each has a spec", () => {
  const { methods, api } = item_calls(source(), { scheme: "x-tasks" });
  expect(Object.keys(methods)).toEqual([...item_method_names]);
  expect(Object.keys(api)).toEqual([...item_method_names]);
  expect(item_method_names.every((name) => /^(list|search|get)_/.test(name))).toBe(true);
  expect(positional_args(api.list_item_changes, { limit: 5 })).toEqual([undefined, 5]);
  expect(input_schema(api.get_items).required).toEqual(["ids"]);
});

test("kinds come from a list or a function", async () => {
  expect(await item_calls(source(), { scheme: "x-tasks" }).methods.list_item_kinds()).toEqual([{ kind: "task", label: "Task" }]);
  const from_function = item_calls(source({ kinds: async () => [{ kind: "note", label: "Note" }] }), { scheme: "x-notes" });
  expect(await from_function.methods.list_item_kinds()).toEqual([{ kind: "note", label: "Note" }]);
});

test("a search gives whole items with links, cut to the limit, and nothing for no words", async () => {
  const { methods } = item_calls(source(), { scheme: "x-tasks" });
  expect(await methods.search_items("milk", 1)).toEqual([
    { id: "a", kind: "task", title: "Task a", snippet: "matches milk", link: "x-tasks://task/a", status: "done", changed_at: "2026-11-01T00:00:00.000Z", detail: { due: "today" } },
  ]);
  expect(await methods.search_items("milk")).toHaveLength(2);
  expect(await methods.search_items("   ")).toEqual([]);
});

test("a limit takes the default when missing and stays within the most allowed", async () => {
  const seen: number[] = [];
  const { methods, api } = item_calls(source({ search: (_query, limit) => (seen.push(limit), []) }), { scheme: "x-tasks", default_limit: 5, max_limit: 50 });
  await methods.search_items("a");
  await methods.search_items("a", 500);
  await methods.search_items("a", 0);
  await methods.search_items("a", 2.7);
  expect(seen).toEqual([5, 50, 1, 2]);
  expect(api.search_items.params[1]!.schema.maximum).toBe(50);
});

test("get gives only the items asked for that still exist", async () => {
  const { methods } = item_calls(source(), { scheme: "x-tasks", max_limit: 3 });
  expect((await methods.get_items(["a", "gone", "a"])).map((item) => item.id)).toEqual(["a"]);
  expect(await methods.get_items([])).toEqual([]);
  await expect(methods.get_items(["a", "b", "c", "d"])).rejects.toThrow("at most 3 ids");
});

test("changes come oldest first after since, deleted ones as their id and kind, ties at the cut kept", async () => {
  const changes = [
    task("c", "2026-11-03T00:00:00.000Z"),
    { id: "x", kind: "task", is_deleted: true as const, changed_at: "2026-11-02T00:00:00.000Z" },
    task("a", "2026-11-01T00:00:00.000Z"),
    task("old", "2026-10-01T00:00:00.000Z"),
    task("d", "2026-11-03T00:00:00.000Z", { link: "x-tasks://task/own" }),
  ];
  const asked: (string | null)[] = [];
  const { methods } = item_calls(source({ changes: (since) => (asked.push(since), changes) }), { scheme: "x-tasks" });

  const all = await methods.list_item_changes(null, 3);
  expect(all.map((change) => change.id)).toEqual(["old", "a", "x", "c", "d"].slice(0, 3));
  expect(all[2]).toEqual({ id: "x", kind: "task", is_deleted: true, changed_at: "2026-11-02T00:00:00.000Z" });
  expect(all[0]).toMatchObject({ is_deleted: false, link: "x-tasks://task/old" });

  const later = await methods.list_item_changes("2026-11-01T00:00:00Z", 2);
  expect(later.map((change) => change.id)).toEqual(["x", "c", "d"]);
  expect(later.at(-1)).toMatchObject({ link: "x-tasks://task/own" });
  expect(asked).toEqual([null, "2026-11-01T00:00:00.000Z"]);

  expect(await methods.list_item_changes()).toHaveLength(5);
  await expect(methods.list_item_changes("yesterday")).rejects.toThrow("since is not a time");
});

test("a scheme a link cannot carry is refused when the calls are made", () => {
  expect(() => item_calls(source(), { scheme: "x_tasks" })).toThrow("not a link scheme");
});

test("without text the calls stay four and kinds carry no has_text", async () => {
  const { methods, api } = item_calls(source({ kinds: [{ kind: "task", label: "Task", has_text: true }] }), { scheme: "x-tasks" });
  expect(item_text_method_name in methods).toBe(false);
  expect(item_text_method_name in api).toBe(false);
  expect(await methods.list_item_kinds()).toEqual([{ kind: "task", label: "Task" }]);
});

// ── Texts ────────────────────────────────────────────────────────────────────

test("an item's text is cut to its bytes at the end of a character", () => {
  expect(clip_item_text("short")).toEqual({ text: "short", is_truncated: false });
  expect(clip_item_text("a".repeat(item_text_max_bytes))).toEqual({ text: "a".repeat(item_text_max_bytes), is_truncated: false });
  expect(clip_item_text("a😀b", 3)).toEqual({ text: "a", is_truncated: true });
  expect(clip_item_text("éé", 3)).toEqual({ text: "é", is_truncated: true });
  const long = clip_item_text("é".repeat(item_text_max_bytes));
  expect(long.is_truncated).toBe(true);
  expect(new TextEncoder().encode(long.text).length).toBe(item_text_max_bytes);
});

test("a source with text adds get_item_texts with its spec, and kinds say has_text", async () => {
  const asked: string[][] = [];
  const { methods, api } = item_calls(
    {
      ...source({ kinds: [{ kind: "task", label: "Task", has_text: true }, { kind: "list", label: "List" }] }),
      text: (ids: string[]) => (
        asked.push(ids),
        [
          { id: "a", text: "# Notes", format: "markdown", changed_at: "2026-11-01T00:00:00.000Z" },
          { id: "a", text: "again", changed_at: "2026-11-01T00:00:00.000Z" },
          { id: "b", text: "", changed_at: "2026-11-01T00:00:00.000Z" },
          { id: "c", text: "x".repeat(item_text_max_bytes + 1), format: "html" as "plain", changed_at: "2026-11-02T00:00:00.000Z" },
          { id: "stranger", text: "not asked", changed_at: "2026-11-01T00:00:00.000Z" },
        ]
      ),
    },
    { scheme: "x-tasks", max_limit: 3 },
  );
  expect(Object.keys(methods)).toEqual([...item_method_names, item_text_method_name]);
  expect(Object.keys(api)).toEqual([...item_method_names, item_text_method_name]);
  expect(input_schema(api.get_item_texts).required).toEqual(["ids"]);
  expect(api.get_item_texts.params[0]!.schema.maxItems).toBe(3);
  expect(api.list_item_kinds.description).toContain("has_text");
  expect(await methods.list_item_kinds()).toEqual([
    { kind: "task", label: "Task", has_text: true },
    { kind: "list", label: "List", has_text: false },
  ]);

  const texts = await methods.get_item_texts(["a", "b", "c", "a"]);
  expect(asked).toEqual([["a", "b", "c"]]);
  expect(texts.map((each) => each.id)).toEqual(["a", "c"]);
  expect(texts[0]).toEqual({ id: "a", text: "# Notes", format: "markdown", changed_at: "2026-11-01T00:00:00.000Z", is_truncated: false });
  expect(texts[1]).toMatchObject({ format: "plain", is_truncated: true });
  expect(texts[1]!.text).toHaveLength(item_text_max_bytes);
  expect(await methods.get_item_texts([])).toEqual([]);
  await expect(methods.get_item_texts(["a", "b", "c", "d"])).rejects.toThrow("at most 3 ids");
});

// ── From history ─────────────────────────────────────────────────────────────

interface NoteSnapshot {
  title: string;
  body: string;
}

function open_notes() {
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  database.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL)");
  const history = create_history<NoteSnapshot>({
    name: "note",
    item_table: "notes",
    watches: [{ table: "notes", item_columns: ["id"] }],
    read: (db, id) => (db.prepare("SELECT title, body FROM notes WHERE id = ?").get(id) as NoteSnapshot | undefined) ?? null,
    apply: (db, id, snapshot) => void db.prepare("INSERT OR REPLACE INTO notes VALUES (?, ?, ?)").run(id, snapshot.title, snapshot.body),
    site: () => "here",
  });
  history.install(database);
  return { database, history };
}

test("changes from history give each item once, as its newest version has it, deleted ones included", async () => {
  vi.useFakeTimers();
  const { database, history } = open_notes();
  const write = (sql: string, at: string) => {
    vi.setSystemTime(new Date(at));
    database.exec(sql);
    history.record(database);
  };
  write("INSERT INTO notes VALUES ('n/1', 'First', 'old body')", "2026-11-01T00:00:00Z");
  write("INSERT INTO notes VALUES ('n2', 'Second', '')", "2026-11-02T00:00:00Z");
  write("UPDATE notes SET body = 'new body' WHERE id = 'n/1'", "2026-11-03T00:00:00Z");
  write("INSERT INTO notes VALUES ('n3', 'Third', ''); INSERT INTO notes VALUES ('n4', 'Fourth', '')", "2026-11-04T00:00:00Z");
  write("DELETE FROM notes WHERE id = 'n2'", "2026-11-05T00:00:00Z");

  const { methods } = item_calls(
    {
      ...source(),
      changes: history_item_changes([{ kind: "note", history, item: (snapshot) => ({ title: snapshot.title, snippet: snapshot.body }), id: (item_id) => `note:${item_id}` }], () => database),
    },
    { scheme: "x-notes" },
  );

  const first = await methods.list_item_changes(null, 2);
  expect(first.map((change) => change.id)).toEqual(["note:n/1", "note:n3", "note:n4"]);
  expect(first[0]).toEqual({
    id: "note:n/1", kind: "note", title: "First", snippet: "new body", link: "x-notes://note/note%3An%2F1", status: "", changed_at: "2026-11-03T00:00:00.000Z", detail: {}, is_deleted: false,
  });

  const next = await methods.list_item_changes(first.at(-1)!.changed_at, 2);
  expect(next).toEqual([{ id: "note:n2", kind: "note", is_deleted: true, changed_at: "2026-11-05T00:00:00.000Z" }]);
  expect(await methods.list_item_changes(next.at(-1)!.changed_at)).toEqual([]);
});

test("history reads the newest version of each item changed after a moment, with ties at the cut", () => {
  vi.useFakeTimers();
  const { database, history } = open_notes();
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  database.exec("INSERT INTO notes VALUES ('a', 'A', ''); INSERT INTO notes VALUES ('b', 'B', ''); INSERT INTO notes VALUES ('c', 'C', '')");
  history.record(database);
  expect(history.read_changed_since(database, "", 1).map((version) => version.item_id)).toEqual(["a", "b", "c"]);
  expect(history.read_changed_since(database, "2026-11-01T00:00:00.000Z", 5)).toEqual([]);
});
