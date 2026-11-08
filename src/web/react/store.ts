// Reads a store's value and redraws the component when it changes.

import type { Store } from "../store.ts";
import { use_watch } from "./watch.ts";

export type { Store, StoreOptions } from "../store.ts";
export { create_store } from "../store.ts";

export function use_store<Value>(store: Store<Value>): Value {
  use_watch(store.watch);
  return store.get();
}
