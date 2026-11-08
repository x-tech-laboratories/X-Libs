// A value a page reads and events change, with a watch that redraws only what reads it.

import { coalesce_bumps, create_watch, type Watch } from "./watch.ts";

export interface Store<Value> {
  get(): Value;
  set(next: Value): void;
  // Sets what make returns from the current value.
  update(make: (current: Value) => Value): void;
  watch: Watch;
}

export interface StoreOptions {
  // Redraws at most once per interval, for a value that changes many times a second.
  coalesce_in_milliseconds?: number;
}

export function create_store<Value>(initial: Value, options: StoreOptions = {}): Store<Value> {
  let value = initial;
  const watch = create_watch();
  const bump = options.coalesce_in_milliseconds ? coalesce_bumps(watch, options.coalesce_in_milliseconds) : watch.bump;
  const set = (next: Value) => {
    value = next;
    bump();
  };
  return {
    get: () => value,
    set,
    update: (make) => set(make(value)),
    watch,
  };
}
