// Tokens declared in an app's config rather than made on its account page, so a scraper's or a script's token can live
// in a NixOS config. Each entry names its client, gives the token's sha256 (or a file holding the token), and takes a
// scope the app maps onto a role, read-only or not; a scope may also be limited, such as to a few of the app's items.
// Only the digest is kept, and a presented token is checked against every one in constant time.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface DeclaredToken {
  name: string;
  // The sha256 of the token, in hex.
  digest: string;
  scope: string;
  // The role it acts with, or null when it signs nothing in and only the app's own checks use it, such as a push route's.
  role: string | null;
  read_only: boolean;
  // The items it is limited to, or null for all of them.
  limited_to: string[] | null;
}

export interface ScopeSpec {
  role: string | null;
  read_only: boolean;
  // Whether entries of this scope may list items they are limited to.
  limitable?: boolean;
}

export interface DeclaredTokenOptions {
  // The scopes an entry may take, by name.
  scopes: Record<string, ScopeSpec>;
  // The entry's key listing what a limitable scope is limited to, such as "monitors"; "limited_to" unless set.
  limit_key?: string;
  // The command that makes a token, named in the warning about a token written in plain text.
  new_token_command?: string;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const hash_prefix = "sha256:";

// A shorter token is refused, since its digest could be guessed.
export const shortest_token = 16;

// ── Tokens ───────────────────────────────────────────────────────────────────

// A fresh random token with a prefix, such as "xm_", so a secret scanner recognises a leaked one.
export function new_declared_token(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

// The `token_hash` value a config gives for a token.
export function token_hash(token: string): string {
  return `${hash_prefix}${sha256_hex(token)}`;
}

// The hex digest in a `token_hash` written as "sha256:<64 hex digits>" or the digits alone, or null when malformed.
export function parse_token_hash(value: unknown): string | null {
  let text = String(value).trim().toLowerCase();
  if (text.startsWith(hash_prefix)) text = text.slice(hash_prefix.length);
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

// The token a request's `Authorization: Bearer` header carries, or null for any other header.
export function bearer_of(header: string | undefined): string | null {
  if (!header) return null;
  const space = header.indexOf(" ");
  if (space === -1) return null;
  const token = header.slice(space + 1).trim();
  return header.slice(0, space).toLowerCase() === "bearer" && token !== "" ? token : null;
}

// The declared token the presented one matches, every digest compared so the time taken tells nothing.
export function match_declared_token(tokens: readonly DeclaredToken[], presented: string | null | undefined): DeclaredToken | null {
  if (!presented) return null;
  const digest = Buffer.from(sha256_hex(presented), "hex");
  let found: DeclaredToken | null = null;
  for (const token of tokens) {
    if (timingSafeEqual(digest, Buffer.from(token.digest, "hex")) && found === null) found = token;
  }
  return found;
}

// ── Reading the config ───────────────────────────────────────────────────────

// The usable entries of a config's token list, each skipped one logged with why.
export function read_declared_tokens(entries: unknown, options: DeclaredTokenOptions): DeclaredToken[] {
  const error = options.error ?? (() => {});
  if (entries === null || entries === undefined) return [];
  if (!Array.isArray(entries)) {
    error("the token list must be a list; no tokens are enabled");
    return [];
  }
  const names = new Set<string>();
  const digests = new Set<string>();
  const tokens: DeclaredToken[] = [];
  for (const entry of entries) {
    const token = read_entry(entry, names, digests, options);
    if (token !== null) tokens.push(token);
  }
  return tokens;
}

function read_entry(entry: unknown, names: Set<string>, digests: Set<string>, options: DeclaredTokenOptions): DeclaredToken | null {
  const error = options.error ?? (() => {});
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    error(`each token entry must be a mapping, got ${JSON.stringify(entry)}`);
    return null;
  }
  const fields = entry as Record<string, unknown>;
  const name = String(fields.name || "").trim();
  if (!name) {
    error("a token entry has no name; skipping it");
    return null;
  }
  if (names.has(name)) {
    error(`token name ${JSON.stringify(name)} is used twice; skipping the second`);
    return null;
  }
  const scope = String(fields.scope || "").trim();
  const spec = Object.hasOwn(options.scopes, scope) ? options.scopes[scope]! : null;
  if (spec === null) {
    error(`token ${JSON.stringify(name)} has scope ${JSON.stringify(scope)}; expected one of ${Object.keys(options.scopes).join(", ")}`);
    return null;
  }
  const digest = digest_of(fields, name, options);
  if (digest === null) return null;
  if (digests.has(digest)) {
    error(`token ${JSON.stringify(name)} has the same secret as another token; skipping it`);
    return null;
  }
  names.add(name);
  digests.add(digest);
  return { name, digest, scope, role: spec.role, read_only: spec.read_only, limited_to: limits_of(fields, name, spec, options) };
}

// The digest from whichever of `token_hash`, `token_file` or `token` the entry sets.
function digest_of(fields: Record<string, unknown>, name: string, options: DeclaredTokenOptions): string | null {
  const error = options.error ?? (() => {});
  if (fields.token_hash !== null && fields.token_hash !== undefined) {
    const digest = parse_token_hash(fields.token_hash);
    if (digest === null) error(`token ${JSON.stringify(name)} has a malformed token_hash; expected sha256:<64 hex digits>`);
    return digest;
  }
  let secret: string | null = null;
  if (fields.token !== null && fields.token !== undefined) {
    const command = options.new_token_command ? ` (from '${options.new_token_command}')` : "";
    options.warn?.(`token ${JSON.stringify(name)} is written in plaintext in the config; use token_hash${command} or token_file instead.`);
    secret = String(fields.token);
  } else if (fields.token_file) {
    try {
      secret = readFileSync(String(fields.token_file), "utf8").trim();
    } catch (problem) {
      error(`could not read token_file ${String(fields.token_file)} for token ${JSON.stringify(name)}: ${(problem as Error).message}`);
      return null;
    }
  }
  if (secret === null) {
    error(`token ${JSON.stringify(name)} needs token_hash, token_file or token`);
    return null;
  }
  if (secret.length < shortest_token) {
    error(`token ${JSON.stringify(name)} is shorter than ${shortest_token} characters`);
    return null;
  }
  return sha256_hex(secret);
}

function limits_of(fields: Record<string, unknown>, name: string, spec: ScopeSpec, options: DeclaredTokenOptions): string[] | null {
  const key = options.limit_key ?? "limited_to";
  const value = fields[key];
  if (value === null || value === undefined) return null;
  if (!spec.limitable) {
    const allowed = Object.entries(options.scopes).filter(([, other]) => other.limitable).map(([other]) => other);
    options.warn?.(`token ${JSON.stringify(name)} lists ${key}, which only a ${allowed.join(" or ")} token uses; ignoring them`);
    return null;
  }
  return (Array.isArray(value) ? value : [value]).map(String);
}

function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
