// Each signed-in user's own preferences kept on the server, such as their dashboards, so they follow the user from one
// device to the next: one JSON value per user and key, read with GET and written with PUT at <api>/account/prefs/<key>.
//
// The app names the keys it allows, each with a check that hands back the value to keep or throws in plain words; an
// unknown key is refused, and a stored value its check no longer passes reads as none. `register_accounts` serves the
// routes when given `prefs`, so a user only ever reaches their own and a read-only token or session only reads them.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";

import { AccountError, type AccountStore } from "./account_store.ts";
import type { Viewer } from "./account_sign_in.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

// Hands back the value to keep, cleaned as the app likes, or throws when it is wrong, an AccountError keeping its status.
export type AccountPrefCheck = (value: unknown) => unknown;

export interface AccountPrefsOptions {
  // The keys a user may keep, each with its check, such as { dashboards: check_dashboards }.
  keys: Record<string, AccountPrefCheck>;
  // The most bytes a value may take as JSON; `default_largest_pref_bytes` unless set.
  largest_bytes?: number;
}

// A preference as the routes answer it: the value and when it changed, or a null value and time when none is kept.
export interface AccountPref {
  key: string;
  value: unknown;
  changed_epoch: number | null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const default_largest_pref_bytes = 256 * 1024;

// ── Reading and writing ──────────────────────────────────────────────────────

function check_of(options: AccountPrefsOptions, key: string): AccountPrefCheck {
  if (!Object.hasOwn(options.keys, key)) throw new AccountError(`No preference named '${key}'.`, 404);
  return options.keys[key]!;
}

// The user's preference, or none when nothing is kept or what is kept no longer passes its check.
export function read_account_pref(accounts: AccountStore, options: AccountPrefsOptions, name: string, key: string): AccountPref {
  const check = check_of(options, key);
  const stored = accounts.pref(name, key);
  if (stored === null) return { key, value: null, changed_epoch: null };
  try {
    return { key, value: check(JSON.parse(stored.value)), changed_epoch: stored.changed_epoch };
  } catch {
    return { key, value: null, changed_epoch: null };
  }
}

// Checks the value, keeps what its check hands back and answers it as stored.
export function write_account_pref(accounts: AccountStore, options: AccountPrefsOptions, name: string, key: string, value: unknown): AccountPref {
  const check = check_of(options, key);
  let kept: unknown;
  try {
    kept = check(value);
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(`The preference '${key}' is not valid: ${(error as Error).message}`);
  }
  const text = JSON.stringify(kept);
  if (text === undefined) throw new AccountError(`The preference '${key}' has no value to keep.`);
  const largest = options.largest_bytes ?? default_largest_pref_bytes;
  if (Buffer.byteLength(text) > largest) throw new AccountError(`The preference '${key}' may take at most ${size_text(largest)}.`, 413);
  const stored = accounts.set_pref(name, key, text);
  return { key, value: kept, changed_epoch: stored.changed_epoch };
}

// A limit as a person reads it, such as "256 KB" or "100 bytes".
function size_text(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${Math.floor(bytes / 1024)} KB`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// The signed-in user's name, refusing a token from the config, which belongs to no user.
function owner_of(viewer: Viewer): string {
  if (viewer.declared) throw new AccountError("A token from the config has no account to keep preferences in.", 403);
  return viewer.name;
}

// Serves GET and PUT <path>/:key inside `register_accounts`' scope, which has already turned away whoever may not.
export function register_account_pref_routes(scope: FastifyInstance, accounts: AccountStore, options: AccountPrefsOptions, path: string): void {
  const largest = options.largest_bytes ?? default_largest_pref_bytes;

  scope.get<{ Params: { key: string } }>(`${path}/:key`, async (request) =>
    read_account_pref(accounts, options, owner_of(request.viewer!), request.params.key));

  // The body may be written out with spaces, so it may run somewhat past the value's own limit.
  scope.put<{ Params: { key: string }; Body: { value?: unknown } | undefined }>(`${path}/:key`, { bodyLimit: largest * 2 + 1024 }, async (request) => {
    const owner = owner_of(request.viewer!);
    const body = request.body;
    if (typeof body !== "object" || body === null || !Object.hasOwn(body, "value")) throw new AccountError("Send the preference as { value }.");
    return write_account_pref(accounts, options, owner, request.params.key, body.value);
  });
}
