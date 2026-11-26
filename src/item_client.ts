// Reading another app through the Application Standard's read-only item calls, and nothing else: the standard's
// POST /api/call/<method> with the arguments as a JSON list in order, falling back to POST /api/<method> for an app not
// yet on the standard path, and the first that answers for an address is remembered. Failures are put in plain words,
// and the token never reaches one. Works wherever fetch does: a server, a daemon or a page.

// ── Imports ──────────────────────────────────────────────────────────────────

import { item_text_formats, type DeletedItem, type Item, type ItemChange, type ItemKind, type ItemMethods, type ItemText, type ItemTextMethods } from "./items.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// The app to read: a name for messages, its address such as https://tasks.example.org, and a token, read-only enough.
export interface ItemApp {
  name: string;
  address: string;
  token: string;
}

export type ItemCallName = keyof ItemMethods | keyof ItemTextMethods;

export interface ItemClientOptions {
  // How long one call may take before it counts as unanswered; 15 seconds unless set.
  wait_ms?: number;
  // How many ids get_items and get_item_texts send at once; 100 unless set, the standard's most.
  page_size?: number;
  // The fetch to use, such as one that trusts a home server's certificate; the global one unless set.
  fetch?: typeof fetch;
}

export interface ItemClient {
  list_item_kinds: () => Promise<ItemKind[]>;
  search_items: (query: string, limit: number) => Promise<Item[]>;
  // Asked for a page at a time, however many ids are given.
  get_items: (ids: string[]) => Promise<Item[]>;
  list_item_changes: (since: string | null, limit: number) => Promise<ItemChange[]>;
  // The items' full texts, a page at a time, or null when the app does not answer get_item_texts.
  get_item_texts: (ids: string[]) => Promise<ItemText[] | null>;
  // Any of the calls with its arguments in order, as the app answered it.
  call: (method: ItemCallName, args: unknown[]) => Promise<unknown>;
}

// Thrown when no path of the app knows the call, so an optional call can be told apart from a failing one.
export class ItemCallMissing extends Error {
  readonly method: string;
  constructor(app_name: string, method: string) {
    super(`${app_name} does not answer the item calls: ${method} is missing.`);
    this.method = method;
  }
}

// ── Paths ────────────────────────────────────────────────────────────────────

// The standard path, then the older one some apps still answer on.
const call_prefixes = ["/api/call/", "/api/"];

// The prefix each address answered on, so later calls go straight there.
const known_prefixes = new Map<string, string>();

// For tests, which start each server afresh.
export function forget_item_prefixes(): void {
  known_prefixes.clear();
}

// The address without a slash at its end, or a plain refusal for anything that is not a web address.
export function checked_item_address(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Give the app's address, such as https://tasks.example.org.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The app's address starts with https:// or http://.");
  return trimmed;
}

function host_of(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

// ── Calls ────────────────────────────────────────────────────────────────────

interface Answer {
  status: number;
  text: string;
}

export function is_deleted_item(change: ItemChange): change is DeletedItem {
  return (change as DeletedItem).is_deleted === true;
}

function is_item(value: unknown): value is Item {
  const item = value as Item | null;
  return typeof item?.id === "string" && item.id !== "" && typeof item.kind === "string";
}

function is_item_text(value: unknown): value is ItemText {
  const text = value as ItemText | null;
  return typeof text?.id === "string" && text.id !== "" && typeof text.text === "string" && typeof text.changed_at === "string";
}

// A client for one app's item calls.
export function item_client(app: ItemApp, options: ItemClientOptions = {}): ItemClient {
  const wait_ms = options.wait_ms ?? 15_000;
  const page_size = options.page_size ?? 100;
  const fetch_of = options.fetch ?? globalThis.fetch;

  async function post(base: string, prefix: string, method: ItemCallName, args: unknown[]): Promise<Answer> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (app.token) headers.authorization = `Bearer ${app.token}`;
    let response: Response;
    try {
      response = await fetch_of(`${base}${prefix}${method}`, { method: "POST", headers, body: JSON.stringify(args), signal: AbortSignal.timeout(wait_ms) });
    } catch (error) {
      const cause = (error as Error).name === "TimeoutError" ? "it did not answer in time" : "nothing answered there";
      throw new Error(`Could not reach ${app.name} at ${host_of(base)}: ${cause}. Check its address, and that it is running.`);
    }
    return { status: response.status, text: await response.text() };
  }

  function parsed(method: ItemCallName, answer: Answer): unknown {
    if (answer.status === 204) return null;
    try {
      return JSON.parse(answer.text);
    } catch {
      throw new Error(`${app.name} does not answer the item calls: ${method} gave no JSON.`);
    }
  }

  async function call(method: ItemCallName, args: unknown[]): Promise<unknown> {
    const base = checked_item_address(app.address);
    const known = known_prefixes.get(base);
    const answers: Answer[] = [];
    for (const prefix of known ? [known, ...call_prefixes.filter((each) => each !== known)] : call_prefixes) {
      const answer = await post(base, prefix, method, args);
      if (answer.status >= 200 && answer.status < 300) {
        known_prefixes.set(base, prefix);
        return parsed(method, answer);
      }
      answers.push(answer);
      // An app found on its prefix that refuses the call says why; another prefix would only be refused too.
      if (prefix === known && answer.status !== 404) break;
    }
    const statuses = answers.map((answer) => answer.status);
    if (statuses.includes(401)) throw new Error(`${app.name} refused the token; make a read-only token in ${app.name} and give it again.`);
    if (statuses.every((status) => status === 404)) throw new ItemCallMissing(app.name, method);
    if (statuses.includes(403)) throw new Error(`${app.name} refused the token for ${method}; give a token that may read.`);
    const last = answers.at(-1)!;
    const said = last.text.trim().slice(0, 200);
    throw new Error(`${app.name} could not answer ${method} (${last.status}${said ? `: ${said}` : ""}).`);
  }

  function list_of<Value>(method: ItemCallName, value: unknown): Value[] {
    if (!Array.isArray(value)) throw new Error(`${app.name} does not answer the item calls: ${method} gave no list.`);
    return value as Value[];
  }

  async function paged<Value>(method: "get_items" | "get_item_texts", ids: string[], keep: (value: unknown) => value is Value): Promise<Value[]> {
    const found: Value[] = [];
    for (let start = 0; start < ids.length; start += page_size) {
      found.push(...list_of<unknown>(method, await call(method, [ids.slice(start, start + page_size)])).filter(keep));
    }
    return found;
  }

  return {
    call,

    list_item_kinds: async () =>
      list_of<ItemKind>("list_item_kinds", await call("list_item_kinds", []))
        .filter((each) => typeof each?.kind === "string")
        .map((each) => ({ kind: each.kind, label: typeof each.label === "string" && each.label ? each.label : each.kind, has_text: each.has_text === true })),

    search_items: async (query, limit) => list_of<unknown>("search_items", await call("search_items", [query, limit])).filter(is_item),

    get_items: (ids) => paged("get_items", ids, is_item),

    list_item_changes: async (since, limit) =>
      list_of<ItemChange>("list_item_changes", await call("list_item_changes", [since, limit])).filter(
        (change) => typeof change?.id === "string" && typeof change.changed_at === "string" && (is_deleted_item(change) || is_item(change)),
      ),

    get_item_texts: async (ids) => {
      try {
        const texts = await paged("get_item_texts", ids, is_item_text);
        return texts.map((each) => ({ ...each, format: item_text_formats.includes(each.format) ? each.format : "plain", is_truncated: each.is_truncated === true }));
      } catch (error) {
        if (error instanceof ItemCallMissing) return null;
        throw error;
      }
    },
  };
}
