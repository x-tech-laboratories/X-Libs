// Password hashes: scrypt with a random salt, and the accounts file an app logs in with, one `name:hash` line per user.

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const key_length = 64;

// Each half of a stored hash is whole bytes of hex.
const hex_pattern = /^(?:[0-9a-f]{2})+$/i;

// How many password hashes run at once and how many more may wait; two leave the rest of Node's thread pool free.
export const default_hashes_at_once = 2;
export const default_hashes_waiting = 8;

const scrypt_async = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

// Each user's name and password hash.
export type Accounts = Map<string, string>;

export const account_name_pattern = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

// A line holding only a hash logs in as this user.
export const default_account_name = "admin";

// ── Hashes ───────────────────────────────────────────────────────────────────

// Stored as `scrypt$<salt hex>$<hash hex>`; this blocks the thread, so a request handler uses `hash_password_async`.
export function hash_password(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, key_length).toString("hex")}`;
}

// The same hash made on Node's thread pool, so other requests go on while it runs.
export async function hash_password_async(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scrypt_async(password, salt, key_length)).toString("hex")}`;
}

// This blocks the thread, so a request handler uses `verify_password_async`.
export function verify_password(password: string, stored: string): boolean {
  const parts = hash_parts(stored);
  if (parts === null) return false;
  return timingSafeEqual(scryptSync(password, parts.salt, parts.expected.length), parts.expected);
}

// The same check made on Node's thread pool, so other requests go on while it runs.
export async function verify_password_async(password: string, stored: string): Promise<boolean> {
  const parts = hash_parts(stored);
  if (parts === null) return false;
  return timingSafeEqual(await scrypt_async(password, parts.salt, parts.expected.length), parts.expected);
}

// The salt and hash a stored hash holds, or null when it is not a whole scrypt hash.
function hash_parts(stored: string): { salt: Buffer; expected: Buffer } | null {
  const [scheme, salt_hex = "", hash_hex = ""] = stored.trim().split("$");
  if (scheme !== "scrypt" || !hex_pattern.test(salt_hex) || !hex_pattern.test(hash_hex)) return null;
  return { salt: Buffer.from(salt_hex, "hex"), expected: Buffer.from(hash_hex, "hex") };
}

// ── Hash slots ───────────────────────────────────────────────────────────────

// What makes and checks hashes for `PasswordHashSlots`; the asynchronous scrypt ones unless a test hands in its own.
export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (password: string, stored: string) => Promise<boolean>;
}

export interface PasswordHashSlotsOptions {
  // How many hashes run at once; `default_hashes_at_once` unless set.
  at_once?: number;
  // How many more may wait for a slot before the next is refused; `default_hashes_waiting` unless set.
  waiting?: number;
  hasher?: PasswordHasher;
}

// A hash refused because every slot is taken and the queue is full, which a route answers with 429 and Retry-After.
export class PasswordHashesBusy extends Error {
  readonly statusCode = 429;
  readonly retry_after_seconds = 1;

  constructor() {
    super("The server is busy checking passwords; try again in a moment.");
    this.name = "PasswordHashesBusy";
  }
}

// Keeps the password hashes a server runs at once to a few with a short queue, so a flood of sign-ins cannot take every thread.
export class PasswordHashSlots {
  private readonly at_once: number;
  private readonly most_waiting: number;
  private readonly hasher: PasswordHasher;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: PasswordHashSlotsOptions = {}) {
    this.at_once = options.at_once ?? default_hashes_at_once;
    this.most_waiting = options.waiting ?? default_hashes_waiting;
    this.hasher = options.hasher ?? { hash: hash_password_async, verify: verify_password_async };
  }

  hash(password: string): Promise<string> {
    return this.in_slot(() => this.hasher.hash(password));
  }

  verify(password: string, stored: string): Promise<boolean> {
    return this.in_slot(() => this.hasher.verify(password, stored));
  }

  // Runs the work once a slot is free, refuses it when the queue is full, and hands the slot on when it ends.
  private async in_slot<Result>(work: () => Promise<Result>): Promise<Result> {
    if (this.running < this.at_once) this.running += 1;
    else if (this.queue.length >= this.most_waiting) throw new PasswordHashesBusy();
    else await new Promise<void>((resume) => this.queue.push(resume));
    try {
      return await work();
    } finally {
      const next = this.queue.shift();
      if (next === undefined) this.running -= 1;
      else next();
    }
  }
}

// The slots every route in the process shares unless it is handed its own.
export const shared_password_hashes = new PasswordHashSlots();

// ── Accounts file ────────────────────────────────────────────────────────────

// Reads `name:hash` lines, skipping blank lines and `#` comments.
export function parse_accounts(text: string, source = "the accounts file"): Accounts {
  const accounts: Accounts = new Map();
  for (const [index, raw_line] of text.split("\n").entries()) {
    const line = raw_line.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    const name = separator === -1 ? default_account_name : line.slice(0, separator);
    const stored = separator === -1 ? line : line.slice(separator + 1);
    const where = `${source} line ${index + 1}`;
    if (!account_name_pattern.test(name)) throw new Error(`${where}: '${name}' is not a user name of lowercase letters, digits, '.', '_' and '-'.`);
    if (!stored.startsWith("scrypt$")) throw new Error(`${where} does not hold a hash from \`npm run hash-password\`.`);
    if (accounts.has(name)) throw new Error(`${where} names '${name}' a second time.`);
    accounts.set(name, stored);
  }
  return accounts;
}

// The accounts in the file the environment variable names, such as X_NIX_PASSWORD_HASH_FILE.
export function load_accounts(variable: string, file_path: string | undefined = process.env[variable]): Accounts {
  if (!file_path) throw new Error(`${variable} is not set; create one with \`npm run hash-password -- <name> <file>\`.`);
  const accounts = parse_accounts(readFileSync(file_path, "utf8"), file_path);
  if (accounts.size === 0) throw new Error(`${file_path} holds no users; add one with \`npm run hash-password -- <name> ${file_path}\`.`);
  return accounts;
}

// Sets one user's line in the accounts file's text, replacing their old one, whether it names them or holds only a hash.
export function set_account(text: string, name: string, stored: string): string {
  const names_user = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith(`${name}:`) || (name === default_account_name && trimmed.startsWith("scrypt$"));
  };
  const kept = text.split("\n").filter((line) => line.trim() !== "" && !names_user(line));
  return [...kept, `${name}:${stored}`].join("\n") + "\n";
}
