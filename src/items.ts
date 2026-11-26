// The four calls every app answers about the items it holds, so another program, such as an assistant gathering a
// user's tasks, notes and bookmarks, reads every app with one piece of code: list_item_kinds, search_items, get_items
// and list_item_changes, all read-only and all answering with one item shape, and get_item_texts, the optional fifth,
// for the full text of items that have more than their snippet. An item's link is <scheme>://<kind>/<id>, such as
// x-tasks://task/a1, with the id percent-encoded.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { ApiSpec, JsonSchema } from "./api_spec.ts";
import type { History } from "./history.ts";
import type { SqlDatabase } from "./sql.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// A kind of item the app holds, such as { kind: "task", label: "Task", has_text: true }.
export interface ItemKind {
  kind: string;
  label: string;
  // Whether items of this kind can have text beyond their snippet, for get_item_texts; left out, it is false.
  has_text?: boolean;
}

export interface Item {
  // The item's own across the whole app; an app whose ids are only unique within a kind puts the kind in front.
  id: string;
  // One of the app's kinds, a plain word in the singular.
  kind: string;
  title: string;
  // Plain text of 200 characters at most.
  snippet: string;
  // <scheme>://<kind>/<id>, which opens the app on the item.
  link: string;
  // A plain word such as done, empty for a kind that has none.
  status: string;
  // When the item last changed, as an ISO time.
  changed_at: string;
  // Anything more the app wants to say, as text by name.
  detail: Record<string, string>;
}

// An item gone from the app, as list_item_changes gives it.
export interface DeletedItem {
  id: string;
  kind: string;
  is_deleted: true;
  changed_at: string;
}

export type ItemChange = (Item & { is_deleted: false }) | DeletedItem;

// An item as the app hands it over: the link is made from its kind and id, and the rest may be left out.
export type ItemFields = Pick<Item, "id" | "kind" | "title" | "changed_at"> & Partial<Pick<Item, "snippet" | "link" | "status" | "detail">>;

// An item's full text, as get_item_texts gives it.
export interface ItemText {
  id: string;
  text: string;
  format: ItemTextFormat;
  changed_at: string;
  // Whether the text was cut to item_text_max_bytes.
  is_truncated: boolean;
}

// The app turns its own HTML or rich text into one of these, so a caller never reads an app's own format.
export type ItemTextFormat = "plain" | "markdown";

export const item_text_formats: readonly ItemTextFormat[] = ["plain", "markdown"];

// An item's text as the app hands it over: plain unless a format is given, cut by item_calls.
export type ItemTextFields = Pick<ItemText, "id" | "text" | "changed_at"> & { format?: ItemTextFormat };

type MaybePromise<Value> = Value | Promise<Value>;

// The app's own answers, which item_calls shapes, cuts and orders.
export interface ItemSource {
  kinds: readonly ItemKind[] | (() => MaybePromise<readonly ItemKind[]>);
  // The items matching the text, best first; limit is how many are wanted.
  search: (query: string, limit: number) => MaybePromise<readonly ItemFields[]>;
  // The items with these ids as they are now, leaving out any that are gone.
  get: (ids: string[]) => MaybePromise<readonly ItemFields[]>;
  // The items changed after since, an ISO time, or every item when it is null, deleted ones included, in any order;
  // at least the limit oldest of them, and any more changed at the same moment as the last.
  changes: (since: string | null, limit: number) => MaybePromise<readonly (ItemFields | DeletedItem)[]>;
  // The full text of the items with these ids, leaving out any that are gone or have none; given only by an app whose
  // items have text beyond their snippet, which then answers get_item_texts.
  text?: (ids: string[]) => MaybePromise<readonly ItemTextFields[]>;
}

// A source that has text, for which item_calls adds get_item_texts.
export type ItemTextSource = ItemSource & Required<Pick<ItemSource, "text">>;

export interface ItemCallOptions {
  // The app's link scheme without "://", such as "x-tasks".
  scheme: string;
  // How many items a call gives when it is not told; 20 unless set.
  default_limit?: number;
  // The most a call gives, and the most ids get_items and get_item_texts take; 100 unless set.
  max_limit?: number;
}

export interface ItemMethods {
  list_item_kinds: () => Promise<ItemKind[]>;
  search_items: (query: string, limit?: number) => Promise<Item[]>;
  get_items: (ids: string[]) => Promise<Item[]>;
  list_item_changes: (since?: string | null, limit?: number) => Promise<ItemChange[]>;
}

export interface ItemTextMethods {
  get_item_texts: (ids: string[]) => Promise<ItemText[]>;
}

export const item_method_names = ["list_item_kinds", "search_items", "get_items", "list_item_changes"] as const;

export const item_text_method_name = "get_item_texts";

export const snippet_length = 200;

// The most text one item gives through get_item_texts, in bytes of UTF-8.
export const item_text_max_bytes = 256 * 1024;

// ── Links ────────────────────────────────────────────────────────────────────

const scheme_pattern = /^[a-z][a-z0-9+.-]*$/i;
const kind_pattern = /^[a-z0-9_-]+$/i;

// An item's link, such as x-tasks://task/a1; the id is percent-encoded, so one holding ":" or "/" reads back whole.
export function item_link(scheme: string, kind: string, id: string): string {
  if (!scheme_pattern.test(scheme)) throw new Error(`not a link scheme: ${scheme}`);
  if (!kind_pattern.test(kind)) throw new Error(`not an item kind: ${kind}`);
  if (id === "") throw new Error("an item link needs an id");
  return `${scheme}://${kind}/${encodeURIComponent(id)}`;
}

export interface ItemLink {
  scheme: string;
  kind: string;
  id: string;
}

// The scheme, kind and id of an item link, or null for anything else; given a scheme, a link of another app is null too.
export function parse_item_link(link: string, scheme?: string): ItemLink | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9_-]+)\/([^/?#]+)$/i.exec(link.trim());
  if (!match) return null;
  const [, found_scheme, kind, encoded] = match as unknown as [string, string, string, string];
  if (scheme !== undefined && found_scheme.toLowerCase() !== scheme.toLowerCase()) return null;
  try {
    return { scheme: found_scheme, kind, id: decodeURIComponent(encoded) };
  } catch {
    return null;
  }
}

// ── Shaping ──────────────────────────────────────────────────────────────────

// Plain text on one line, cut to 200 characters with an ellipsis, never splitting a character.
export function clip_snippet(text: string, length = snippet_length): string {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.length <= length ? characters.join("") : `${characters.slice(0, length - 1).join("").trimEnd()}…`;
}

function to_item(fields: ItemFields, scheme: string): Item {
  return {
    id: fields.id,
    kind: fields.kind,
    title: fields.title,
    snippet: clip_snippet(fields.snippet ?? ""),
    link: fields.link ?? item_link(scheme, fields.kind, fields.id),
    status: fields.status ?? "",
    changed_at: fields.changed_at,
    detail: fields.detail ?? {},
  };
}

// The text cut to at most max_bytes of UTF-8 at the end of a character, and whether it was cut.
export function clip_item_text(text: string, max_bytes = item_text_max_bytes): { text: string; is_truncated: boolean } {
  // Each character takes at most four bytes, so a short text needs no encoding.
  if (text.length * 3 <= max_bytes) return { text, is_truncated: false };
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max_bytes) return { text, is_truncated: false };
  let end = max_bytes;
  // A byte 10xxxxxx continues a character, so the cut moves back to where one starts.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), is_truncated: true };
}

const is_deleted = (change: ItemFields | DeletedItem): change is DeletedItem => "is_deleted" in change && change.is_deleted === true;

function time_of(text: string, name: string): number {
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new Error(`${name} is not a time: ${text}`);
  return time;
}

// ── Calls ────────────────────────────────────────────────────────────────────

const limit_schema = (max: number, what: string): JsonSchema => ({ type: "integer", minimum: 1, maximum: max, description: `How many ${what} at most.` });

// The four item calls on the app's own answers, with their api_spec entries, to spread into its method table and spec;
// and get_item_texts as well for a source that has text.
export function item_calls(source: ItemTextSource, options: ItemCallOptions): { methods: ItemMethods & ItemTextMethods; api: ApiSpec<ItemMethods & ItemTextMethods> };
export function item_calls(source: ItemSource, options: ItemCallOptions): { methods: ItemMethods; api: ApiSpec<ItemMethods> };
export function item_calls(source: ItemSource, options: ItemCallOptions): { methods: ItemMethods & Partial<ItemTextMethods>; api: ApiSpec<ItemMethods> & Partial<ApiSpec<ItemTextMethods>> } {
  const { scheme } = options;
  const max_limit = options.max_limit ?? 100;
  const default_limit = Math.min(options.default_limit ?? 20, max_limit);
  item_link(scheme, "check", "check");
  const limit_of = (limit: number | undefined) =>
    limit === undefined || limit === null || !Number.isFinite(limit) ? default_limit : Math.min(max_limit, Math.max(1, Math.floor(limit)));

  const { text } = source;
  const checked_ids = (ids: string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length > max_limit) throw new Error(`ask for at most ${max_limit} ids at once`);
    return unique;
  };

  const methods: ItemMethods & Partial<ItemTextMethods> = {
    list_item_kinds: async () =>
      [...(typeof source.kinds === "function" ? await source.kinds() : source.kinds)].map(({ kind, label, has_text }) =>
        text ? { kind, label, has_text: has_text === true } : { kind, label },
      ),

    search_items: async (query, limit) => {
      const wanted = limit_of(limit);
      const text = String(query ?? "").trim();
      if (text === "") return [];
      return (await source.search(text, wanted)).slice(0, wanted).map((fields) => to_item(fields, scheme));
    },

    get_items: async (ids) => {
      const unique = checked_ids(ids);
      if (unique.length === 0) return [];
      const asked = new Set(unique);
      return (await source.get(unique)).filter((fields) => asked.has(fields.id)).map((fields) => to_item(fields, scheme));
    },

    list_item_changes: async (since, limit) => {
      const wanted = limit_of(limit);
      const after = since === undefined || since === null || since === "" ? null : time_of(since, "since");
      const changes = (await source.changes(after === null ? null : new Date(after).toISOString(), wanted))
        .map((change) => ({ change, time: time_of(change.changed_at, `the change to ${change.id}`) }))
        .filter(({ time }) => after === null || time > after)
        .sort((first, second) => first.time - second.time);
      // Changes at the same moment as the last one given all go, so a caller going on from that moment misses none.
      let end = Math.min(wanted, changes.length);
      while (end < changes.length && changes[end]!.time === changes[end - 1]!.time) end++;
      return changes.slice(0, end).map(({ change }): ItemChange =>
        is_deleted(change)
          ? { id: change.id, kind: change.kind, is_deleted: true, changed_at: change.changed_at }
          : { ...to_item(change, scheme), is_deleted: false },
      );
    },
  };

  if (text) {
    methods.get_item_texts = async (ids) => {
      const unique = checked_ids(ids);
      if (unique.length === 0) return [];
      const asked = new Set(unique);
      const given = new Set<string>();
      const texts: ItemText[] = [];
      for (const fields of await text(unique)) {
        if (!asked.has(fields.id) || given.has(fields.id) || typeof fields.text !== "string" || fields.text === "") continue;
        given.add(fields.id);
        const format = fields.format === "markdown" ? "markdown" : "plain";
        const clipped = clip_item_text(fields.text);
        texts.push({ id: fields.id, text: clipped.text, format, changed_at: fields.changed_at, is_truncated: clipped.is_truncated });
      }
      return texts;
    };
  }

  const api: ApiSpec<ItemMethods> & Partial<ApiSpec<ItemTextMethods>> = {
    list_item_kinds: {
      description: text
        ? "Lists the kinds of item this app holds, each with its label, such as task and Task, and has_text, true when items of that kind can have text beyond their snippet, read with get_item_texts."
        : "Lists the kinds of item this app holds, each with its label, such as task and Task.",
      params: [],
    },
    search_items: {
      description:
        "Finds items by the text given, best first. Each item has its id, kind, title, a plain-text snippet, a link that opens it in the app, a status word, when it last changed, and more by name in detail.",
      params: [
        { name: "query", schema: { type: "string", description: "The words to look for." } },
        { name: "limit", schema: limit_schema(max_limit, "items"), optional: true },
      ],
    },
    get_items: {
      description: "Gives the items with these ids as they are now. An id left out of the answer is gone from the app.",
      params: [{ name: "ids", schema: { type: "array", items: { type: "string" }, maxItems: max_limit, description: "The items' ids." } }],
    },
    list_item_changes: {
      description:
        "Lists the items changed after a moment, oldest first, deleted ones included as their id, kind and is_deleted. Keep the changed_at of the last one and pass it as since next time to miss nothing.",
      params: [
        { name: "since", schema: { type: ["string", "null"], format: "date-time", description: "An ISO time; leave it out for every item." }, optional: true },
        { name: "limit", schema: limit_schema(max_limit, "items"), optional: true },
      ],
    },
  };
  if (text) {
    api.get_item_texts = {
      description: `Gives the full text of the items with these ids, each as its id, text, format (plain or markdown), changed_at and is_truncated, true when the text was cut to ${item_text_max_bytes / 1024} KB. An id that is gone, unknown or has no text is left out. Ask only for items of a kind with has_text whose changed_at moved since the text was last read.`,
      params: [{ name: "ids", schema: { type: "array", items: { type: "string" }, maxItems: max_limit, description: "The items' ids." } }],
    };
  }

  return { methods, api };
}

// ── From history ─────────────────────────────────────────────────────────────

// One kind of item whose changes come from its create_history versions: the newest version of each item is the item
// as it is now, and a deleted version says it is gone.
export interface HistoryItemKind<Snapshot> {
  kind: string;
  history: Pick<History<Snapshot>, "read_changed_since">;
  // The item's title, and its snippet, status and detail if it has them, from its snapshot.
  item: (snapshot: Snapshot, item_id: string) => Omit<ItemFields, "id" | "kind" | "changed_at">;
  // The item's id across the app from its id in the history, such as "book:" in front; the same unless set.
  id?: (item_id: string) => string;
}

// An ItemSource's changes answered from the histories of the app's kinds of item.
export function history_item_changes<Snapshot>(kinds: readonly HistoryItemKind<Snapshot>[], database: () => SqlDatabase): ItemSource["changes"] {
  return (since, limit) =>
    kinds.flatMap(({ kind, history, item, id: id_of = (item_id: string) => item_id }) =>
      history.read_changed_since(database(), since ?? "", limit).map((version): ItemFields | DeletedItem => {
        const id = id_of(version.item_id);
        if (version.kind === "deleted") return { id, kind, is_deleted: true, changed_at: version.changed_at };
        return { ...item(version.snapshot, version.item_id), id, kind, changed_at: version.changed_at };
      }),
    );
}
