// Reading a notification channel's settings: a secret given inline or as a file holding it, and a setting given once
// for every kind of message or per kind with defaults for the rest.

// ── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";

// ── Secrets ──────────────────────────────────────────────────────────────────

// The setting `key_file` names a file holding it, read once and trimmed; otherwise `key` itself; null when neither is set.
export function setting_secret(config: Record<string, unknown>, key: string): string | null {
  const path = config[`${key}_file`];
  if (path) {
    try {
      return readFileSync(String(path), "utf8").trim() || null;
    } catch (error) {
      throw new Error(`could not read ${key}_file ${String(path)}: ${(error as Error).message}`);
    }
  }
  const value = config[key];
  return value ? String(value) : null;
}

// ── Per-kind settings ────────────────────────────────────────────────────────

// A setting given once for every key, or as a mapping that overrides some of the defaults; other keys are refused.
export function per_key<Value>(value: unknown, defaults: Record<string, Value>, name: string, allowed: readonly string[] = Object.keys(defaults)): Record<string, Value> {
  if (value === null || value === undefined) return { ...defaults };
  if (typeof value === "object" && !Array.isArray(value)) {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
    if (unknown.length > 0) throw new Error(`\`${name}\` keys must be ${allowed.join(", ")}, not ${JSON.stringify(unknown)}`);
    return { ...defaults, ...(value as Record<string, Value>) };
  }
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, value as Value]));
}

// A list given as a list or as one comma-separated string, its entries trimmed and the empty ones dropped.
export function list_setting(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter((entry) => entry !== "");
  if (value === null || value === undefined) return [];
  return String(value).split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
}
