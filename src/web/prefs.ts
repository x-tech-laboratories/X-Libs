// Remembered view settings: a stored value that is corrupt, from an older version or of the wrong shape reads as the default.

// ── Storage ──────────────────────────────────────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Validator<Value> = (value: unknown) => value is Value;

// This browser's localStorage, or nothing where there is none or it may not be touched.
export function browser_storage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

// ── Reading and writing ──────────────────────────────────────────────────────

// The stored value, or the initial one whenever the stored one cannot be used.
export function read_pref<Value>(storage: StorageLike | undefined, key: string, initial: Value, validate?: Validator<Value>): Value {
  if (!storage) return initial;

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return initial;
  }
  if (raw === null) return initial;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initial;
  }

  if (validate) return validate(parsed) ? parsed : initial;

  // Without a validator the stored value must at least have the initial value's shape.
  if (parsed === null || initial === null) return (parsed as Value) ?? initial;
  if (Array.isArray(initial) !== Array.isArray(parsed)) return initial;
  if (typeof parsed !== typeof initial) return initial;
  return parsed as Value;
}

export function write_pref(storage: StorageLike | undefined, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled storage keeps the setting until the page closes.
  }
}

// ── Validators ───────────────────────────────────────────────────────────────

export function one_of<Value extends string>(...allowed: readonly Value[]): Validator<Value> {
  return (value: unknown): value is Value => typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function is_boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function is_number_in(min: number, max: number): Validator<number> {
  return (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
