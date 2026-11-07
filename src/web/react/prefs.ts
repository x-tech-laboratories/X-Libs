// A remembered setting as component state, read once when the component mounts and written on every change.

import { useState } from "react";
import { browser_storage, read_pref, write_pref, type StorageLike, type Validator } from "../prefs.ts";

export function use_pref<Value>(key: string, initial: Value, validate?: Validator<Value>, storage: StorageLike | undefined = browser_storage()): [Value, (next: Value) => void] {
  const [value, set_value] = useState(() => read_pref(storage, key, initial, validate));
  const change = (next: Value): void => {
    set_value(next);
    write_pref(storage, key, next);
  };
  return [value, change];
}
