// The page's one way to the data, whichever host it runs on, and a watch every view reloads on when anything changed,
// here or on another page or device. An app gets its own typed calls through page_hooks.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Client } from "../../electron/bridge.ts";
import { use_resource, type Resource } from "../../web/react/states.tsx";
import { create_watch } from "../../web/watch.ts";
import { is_read_only } from "../define.ts";
import type { PageApi } from "../protocol.ts";

// ── Api ──────────────────────────────────────────────────────────────────────

type AnyMethods = Record<string, (...args: never[]) => unknown>;

// Bumped after each write this page makes and each change from elsewhere.
export const data_watch = create_watch();

let page_api: PageApi | null = null;

// A write tells this page's views too, since the host only tells the other pages.
export function set_page_api<Methods extends Record<keyof Methods, (...args: never[]) => unknown>>(api: PageApi<Methods>): void {
  const calls = Object.fromEntries(
    Object.entries(api.calls).map(([name, call]) => [
      name,
      async (...args: unknown[]) => {
        const result: unknown = await (call as (...args: unknown[]) => Promise<unknown>)(...args);
        if (!is_read_only(name)) data_watch.bump();
        return result;
      },
    ]),
  ) as Client<AnyMethods>;
  page_api = { ...(api as unknown as PageApi), calls };
  api.on_change(() => data_watch.bump());
}

export function page(): PageApi {
  if (!page_api) throw new Error("the page's api has not been set up");
  return page_api;
}

// Every data call, such as calls().get_settings().
export function calls(): Client<AnyMethods> {
  return page().calls;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

// Loads with the page's calls and loads again quietly whenever the data changed.
export function use_data<Data>(load: (api: Client<AnyMethods>) => Promise<Data>, dependencies: unknown[] = []): Resource<Data> {
  return use_resource(() => load(calls()), dependencies, { watch: data_watch });
}

// Every setting, the ones never set at their defaults.
export function use_settings(): Resource<Record<string, unknown>> {
  return use_data((api) => api.get_settings!() as Promise<Record<string, unknown>>);
}

// The page's calls typed with the app's own, such as page_hooks<AppMethodsOf<typeof app>>().
export function page_hooks<Methods extends Record<keyof Methods, (...args: never[]) => unknown>>() {
  return {
    page: page as () => PageApi<Methods>,
    calls: calls as unknown as () => Client<Methods>,
    use_data: use_data as unknown as <Data>(load: (api: Client<Methods>) => Promise<Data>, dependencies?: unknown[]) => Resource<Data>,
    use_settings,
  };
}
