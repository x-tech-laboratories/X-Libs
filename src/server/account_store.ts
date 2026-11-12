// Who may sign in and what each may do, kept in the app's SQLite database: users with a role and the app's own access
// rules, their second factor, the sessions they are signed in with, and the tokens their devices and scripts use.
//
// Users named in the accounts file are declared: they hold the highest role, and the page cannot change their role or
// password, only their second factor. Every other user lives in the database and is managed from the page.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";

import { migrate, type SqlDatabase, type SqlValue } from "../sql.ts";
import { account_name_pattern, hash_password, verify_password, type Accounts } from "./passwords.ts";
import { match_declared_token, type DeclaredToken } from "./declared_tokens.ts";
import { matching_step, new_secret, otpauth_uri } from "./totp.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface User {
  name: string;
  role: string;
  // The app's own rules for what the user reaches, or null for everything.
  access: unknown;
  totp_enabled: boolean;
  has_password: boolean;
  source: "declared" | "page";
  created_epoch: number;
}

export interface SessionInfo {
  id: number;
  name: string;
  // Whether "Keep me signed in" was ticked.
  remember: boolean;
  // What signed in, such as the browser.
  label: string;
  created_epoch: number;
  last_seen_epoch: number;
  // When it ends on its own, or null for when the browser closes or it is revoked.
  expires_epoch: number | null;
}

export interface Token {
  id: number;
  name: string;
  owner: string;
  // A read-only token can only make GET requests.
  read_only: boolean;
  created_epoch: number;
  last_used_epoch: number | null;
}

export class AccountError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AccountError";
    this.status = status;
  }
}

export interface AccountStoreOptions {
  database: SqlDatabase;
  // The app's name, shown in authenticator apps.
  app_name: string;
  // The roles from least to most able; ["user", "admin"] unless set.
  roles?: readonly string[];
  // The users from the accounts file, who hold the highest role.
  declared?: Accounts;
  // Checks the app's access rules for a user, throwing AccountError when they are wrong; only null is accepted unless set.
  check_access?: (value: unknown) => unknown;
  // What a token starts with, so it can be recognised; "xt" unless set.
  token_prefix?: string;
  // The fewest characters a password may have; 12 unless set.
  shortest_password?: number;
  // Tokens from the app's config, read by `read_declared_tokens`, which no page can list or revoke.
  declared_tokens?: readonly DeclaredToken[];
}

// ── Settings ─────────────────────────────────────────────────────────────────

const recovery_code_count = 8;
const default_roles = ["user", "admin"] as const;

// A session's last-seen time is written at most this often.
const seen_interval_in_seconds = 60;

const schema = [`
  CREATE TABLE account_users (
    name TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    access TEXT,
    password_hash TEXT,
    totp_secret TEXT,
    totp_pending TEXT,
    totp_last_step INTEGER,
    recovery_codes TEXT,
    created_epoch INTEGER NOT NULL
  );
  CREATE TABLE account_sessions (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    remember INTEGER NOT NULL,
    label TEXT NOT NULL,
    created_epoch INTEGER NOT NULL,
    last_seen_epoch INTEGER NOT NULL,
    expires_epoch INTEGER
  );
  CREATE INDEX account_sessions_by_name ON account_sessions (name);
  CREATE TABLE account_tokens (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    read_only INTEGER NOT NULL,
    created_epoch INTEGER NOT NULL,
    last_used_epoch INTEGER
  );
`];

type Row = Record<string, SqlValue>;

// ── Store ────────────────────────────────────────────────────────────────────

export class AccountStore {
  readonly app_name: string;
  readonly roles: readonly string[];
  private readonly database: SqlDatabase;
  private readonly declared: Accounts;
  private readonly check_access: (value: unknown) => unknown;
  private readonly token_prefix: string;
  private readonly shortest_password: number;
  private declared_token_list: readonly DeclaredToken[];

  constructor(options: AccountStoreOptions) {
    this.database = options.database;
    this.app_name = options.app_name;
    this.roles = options.roles ?? default_roles;
    this.declared = options.declared ?? new Map();
    this.check_access = options.check_access ?? only_everything;
    this.token_prefix = options.token_prefix ?? "xt";
    this.shortest_password = options.shortest_password ?? 12;
    this.declared_token_list = options.declared_tokens ?? [];
    if (this.roles.length === 0) throw new Error("An account store needs at least one role.");
    migrate(this.database, schema, { owner: "accounts" });
  }

  // The role that can do everything, which declared users hold.
  get top_role(): string {
    return this.roles[this.roles.length - 1]!;
  }

  has_role(role: string, needed: string): boolean {
    return this.roles.indexOf(role) >= this.roles.indexOf(needed);
  }

  // ── Users ────────────────────────────────────────────────────────────────

  user(name: string): User | null {
    const row = this.get("SELECT * FROM account_users WHERE name = ?", name);
    if (this.declared.has(name)) {
      return {
        name, role: this.top_role, access: null, has_password: true, source: "declared",
        totp_enabled: Boolean(row?.totp_secret), created_epoch: Number(row?.created_epoch ?? 0),
      };
    }
    return row ? user_of(row) : null;
  }

  users(): User[] {
    const page = this.all("SELECT * FROM account_users ORDER BY name").filter((row) => !this.declared.has(String(row.name))).map(user_of);
    return [...[...this.declared.keys()].sort().map((name) => this.user(name)!), ...page];
  }

  // Checks the password and, when the user has one, the second factor; a recovery code stands in for a code once.
  authenticate(name: string, password: string, code: string | undefined): { user: User | null; needs_code: boolean } {
    const user = this.user(name);
    const stored = this.password_hash(name);
    // A missing user still costs a hash, so timing does not tell which names exist.
    const password_ok = verify_password(password, stored ?? stand_in_hash);
    if (user === null || stored === null || !password_ok) return { user: null, needs_code: false };
    if (!user.totp_enabled) return { user, needs_code: false };
    if (!code) return { user: null, needs_code: true };
    return { user: this.second_factor(name, code) ? user : null, needs_code: true };
  }

  create_user(fields: { name: unknown; role: unknown; access: unknown; password: unknown }): User {
    const name = String(fields.name ?? "").trim();
    if (!account_name_pattern.test(name)) throw new AccountError("A user name is lowercase letters, digits, '.', '_' or '-', starting with a letter or digit.");
    if (this.user(name) !== null) throw new AccountError(`A user named '${name}' already exists.`, 409);
    const role = this.checked_role(fields.role);
    const access = this.check_access(fields.access ?? null);
    const password = fields.password === undefined || fields.password === "" ? null : this.checked_password(fields.password);
    this.run(
      "INSERT INTO account_users (name, role, access, password_hash, created_epoch) VALUES (?, ?, ?, ?, ?)",
      name, role, access === null ? null : JSON.stringify(access), password === null ? null : hash_password(password), now_seconds(),
    );
    return this.user(name)!;
  }

  update_user(name: string, fields: { role?: unknown; access?: unknown; password?: unknown }): User {
    this.refuse_declared(name, "its role and password come from the accounts file");
    if (this.user(name) === null) throw new AccountError(`No user named '${name}'.`, 404);
    if (fields.role !== undefined) this.run("UPDATE account_users SET role = ? WHERE name = ?", this.checked_role(fields.role), name);
    if (fields.access !== undefined) {
      const access = this.check_access(fields.access);
      this.run("UPDATE account_users SET access = ? WHERE name = ?", access === null ? null : JSON.stringify(access), name);
    }
    if (fields.password !== undefined && fields.password !== "") {
      this.run("UPDATE account_users SET password_hash = ? WHERE name = ?", hash_password(this.checked_password(fields.password)), name);
    }
    return this.user(name)!;
  }

  // Removes the user with their sessions and tokens.
  delete_user(name: string): void {
    this.refuse_declared(name, "it is in the accounts file");
    if (this.user(name) === null) throw new AccountError(`No user named '${name}'.`, 404);
    this.run("DELETE FROM account_users WHERE name = ?", name);
    this.run("DELETE FROM account_sessions WHERE name = ?", name);
    this.run("DELETE FROM account_tokens WHERE owner = ?", name);
  }

  change_password(name: string, current: unknown, next: unknown): void {
    this.refuse_declared(name, "its password is in the accounts file");
    const stored = this.password_hash(name);
    if (stored === null || typeof current !== "string" || !verify_password(current, stored)) {
      throw new AccountError("The current password is wrong.", 403);
    }
    this.run("UPDATE account_users SET password_hash = ? WHERE name = ?", hash_password(this.checked_password(next)), name);
  }

  // ── Second factor ────────────────────────────────────────────────────────

  // Starts setting up a second factor: the secret waits until a code from it proves the app has it.
  start_totp(name: string): { secret: string; uri: string } {
    this.ensure_row(name);
    const secret = new_secret();
    this.run("UPDATE account_users SET totp_pending = ? WHERE name = ?", secret, name);
    return { secret, uri: otpauth_uri(secret, name, this.app_name) };
  }

  confirm_totp(name: string, code: unknown): string[] {
    const row = this.get("SELECT totp_pending FROM account_users WHERE name = ?", name);
    const pending = row?.totp_pending ? String(row.totp_pending) : null;
    if (pending === null) throw new AccountError("Start setting up the second factor first.");
    const step = matching_step(pending, String(code ?? ""));
    if (step === null) throw new AccountError("That code does not match; check the phone's clock and try the next one.");
    const codes = Array.from({ length: recovery_code_count }, () => randomBytes(5).toString("hex"));
    this.run(
      "UPDATE account_users SET totp_secret = ?, totp_pending = NULL, totp_last_step = ?, recovery_codes = ? WHERE name = ?",
      pending, step, JSON.stringify(codes.map(digest)), name,
    );
    return codes;
  }

  disable_totp(name: string, code: unknown): void {
    if (!this.second_factor(name, String(code ?? ""))) throw new AccountError("That code does not match.", 403);
    this.reset_totp(name);
  }

  // For an admin helping someone who lost their phone.
  reset_totp(name: string): void {
    this.run("UPDATE account_users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = NULL, recovery_codes = NULL WHERE name = ?", name);
  }

  // A code from the app, each used once, or one of the recovery codes, each used once.
  private second_factor(name: string, code: string): boolean {
    const row = this.get("SELECT totp_secret, totp_last_step, recovery_codes FROM account_users WHERE name = ?", name);
    if (!row?.totp_secret) return false;
    const step = matching_step(String(row.totp_secret), code);
    if (step !== null) {
      if (row.totp_last_step !== null && step <= Number(row.totp_last_step)) return false;
      this.run("UPDATE account_users SET totp_last_step = ? WHERE name = ?", step, name);
      return true;
    }
    const recovery = JSON.parse(String(row.recovery_codes ?? "[]")) as string[];
    const index = recovery.indexOf(digest(code.trim().toLowerCase()));
    if (index === -1) return false;
    recovery.splice(index, 1);
    this.run("UPDATE account_users SET recovery_codes = ? WHERE name = ?", JSON.stringify(recovery), name);
    return true;
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  // Opens a session and hands back the secret its cookie holds; only a digest of it is kept.
  open_session(name: string, fields: { remember: boolean; label: string; lifetime_in_seconds: number | null }): { secret: string; id: number } {
    const secret = randomBytes(32).toString("base64url");
    const now = now_seconds();
    const expires = fields.lifetime_in_seconds === null ? null : now + fields.lifetime_in_seconds;
    const id = this.run(
      "INSERT INTO account_sessions (hash, name, remember, label, created_epoch, last_seen_epoch, expires_epoch) VALUES (?, ?, ?, ?, ?, ?, ?)",
      digest(secret), name, fields.remember ? 1 : 0, fields.label.slice(0, 200), now, now, expires,
    );
    return { secret, id };
  }

  // The session the secret opens, noting it was seen, or null when it is unknown, ended or its user is gone.
  session(secret: string): SessionInfo | null {
    const row = this.get("SELECT * FROM account_sessions WHERE hash = ?", digest(secret));
    if (!row) return null;
    const session = session_of(row);
    const now = now_seconds();
    if ((session.expires_epoch !== null && session.expires_epoch <= now) || this.user(session.name) === null) {
      this.run("DELETE FROM account_sessions WHERE id = ?", session.id);
      return null;
    }
    if (now - session.last_seen_epoch >= seen_interval_in_seconds) {
      this.run("UPDATE account_sessions SET last_seen_epoch = ? WHERE id = ?", now, session.id);
      session.last_seen_epoch = now;
    }
    return session;
  }

  sessions(name: string): SessionInfo[] {
    this.run("DELETE FROM account_sessions WHERE expires_epoch IS NOT NULL AND expires_epoch <= ?", now_seconds());
    return this.all("SELECT * FROM account_sessions WHERE name = ? ORDER BY last_seen_epoch DESC", name).map(session_of);
  }

  // Ends one of the user's sessions.
  close_session(name: string, id: number): void {
    const changed = this.run("DELETE FROM account_sessions WHERE id = ? AND name = ?", id, name);
    if (changed === 0) throw new AccountError("No such session.", 404);
  }

  // Ends every session of the user except the one kept, such as after their password or access changed.
  close_sessions(name: string, keep: number | null = null): void {
    this.run("DELETE FROM account_sessions WHERE name = ? AND id IS NOT ?", name, keep);
  }

  // ── Tokens ───────────────────────────────────────────────────────────────

  // A token that acts as its owner, shown once; only its digest is kept.
  create_token(owner: string, fields: { name: unknown; read_only: unknown }): { token: string; id: number } {
    const label = String(fields.name ?? "").trim();
    if (!label || label.length > 64) throw new AccountError("Give the token a name of up to 64 characters, such as what will use it.");
    if (this.user(owner) === null) throw new AccountError(`No user named '${owner}'.`, 404);
    const token = `${this.token_prefix}_${randomBytes(32).toString("base64url")}`;
    const id = this.run(
      "INSERT INTO account_tokens (name, hash, owner, read_only, created_epoch) VALUES (?, ?, ?, ?, ?)",
      label, digest(token), owner, fields.read_only === false ? 0 : 1, now_seconds(),
    );
    return { token, id };
  }

  // Every token, or only the owner's.
  tokens(owner?: string): Token[] {
    const rows = owner === undefined
      ? this.all("SELECT * FROM account_tokens ORDER BY id")
      : this.all("SELECT * FROM account_tokens WHERE owner = ? ORDER BY id", owner);
    return rows.map(token_of);
  }

  // Revokes a token, only among the owner's when one is named.
  delete_token(id: number, owner?: string): void {
    const changed = owner === undefined
      ? this.run("DELETE FROM account_tokens WHERE id = ?", id)
      : this.run("DELETE FROM account_tokens WHERE id = ? AND owner = ?", id, owner);
    if (changed === 0) throw new AccountError("No such token.", 404);
  }

  // The token when it is valid and its owner still exists, noting when it was last used.
  check_token(token: string): Token | null {
    const row = this.get("SELECT * FROM account_tokens WHERE hash = ?", digest(token));
    if (!row || this.user(String(row.owner)) === null) return null;
    const now = now_seconds();
    this.run("UPDATE account_tokens SET last_used_epoch = ? WHERE id = ?", now, Number(row.id));
    return { ...token_of(row), last_used_epoch: now };
  }

  // The config's tokens, which a reload of the config may replace.
  get declared_tokens(): readonly DeclaredToken[] {
    return this.declared_token_list;
  }

  set_declared_tokens(tokens: readonly DeclaredToken[]): void {
    this.declared_token_list = tokens;
  }

  // The config's token the presented one matches, or null.
  check_declared_token(token: string): DeclaredToken | null {
    return match_declared_token(this.declared_token_list, token);
  }

  // ── Checks ───────────────────────────────────────────────────────────────

  private checked_role(value: unknown): string {
    if (typeof value !== "string" || !this.roles.includes(value)) throw new AccountError(`The role must be ${this.roles.join(", ")}.`);
    return value;
  }

  private checked_password(value: unknown): string {
    if (typeof value !== "string" || value.length < this.shortest_password) {
      throw new AccountError(`A password needs at least ${this.shortest_password} characters.`);
    }
    return value;
  }

  private password_hash(name: string): string | null {
    const declared = this.declared.get(name);
    if (declared !== undefined) return declared;
    const row = this.get("SELECT password_hash FROM account_users WHERE name = ?", name);
    return row?.password_hash ? String(row.password_hash) : null;
  }

  private refuse_declared(name: string, why: string): void {
    if (this.declared.has(name)) throw new AccountError(`'${name}' cannot be changed here: ${why}.`, 403);
  }

  // A declared user has no row until their second factor needs one.
  private ensure_row(name: string): void {
    if (this.get("SELECT name FROM account_users WHERE name = ?", name)) return;
    if (!this.declared.has(name)) throw new AccountError(`No user named '${name}'.`, 404);
    this.run("INSERT INTO account_users (name, role, created_epoch) VALUES (?, ?, ?)", name, this.top_role, now_seconds());
  }

  // ── Database ─────────────────────────────────────────────────────────────

  private get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.database.prepare(sql).get(...params) as Row | undefined;
  }

  private all(sql: string, ...params: SqlValue[]): Row[] {
    return this.database.prepare(sql).all(...params) as Row[];
  }

  // The new row's id for an insert, or how many rows changed otherwise.
  private run(sql: string, ...params: SqlValue[]): number {
    const result = this.database.prepare(sql).run(...params);
    return Number(sql.trimStart().startsWith("INSERT") ? result.lastInsertRowid : result.changes);
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

// An unknown name is checked against this hash, so it takes as long to refuse as a wrong password.
const stand_in_hash = hash_password(randomBytes(16).toString("hex"));

function only_everything(value: unknown): null {
  if (value !== null) throw new AccountError("This app grants everything or nothing, so access must be null.");
  return null;
}

function user_of(row: Row): User {
  return {
    name: String(row.name),
    role: String(row.role),
    access: row.access === null ? null : JSON.parse(String(row.access)),
    totp_enabled: Boolean(row.totp_secret),
    has_password: Boolean(row.password_hash),
    source: "page",
    created_epoch: Number(row.created_epoch),
  };
}

function session_of(row: Row): SessionInfo {
  return {
    id: Number(row.id),
    name: String(row.name),
    remember: Boolean(row.remember),
    label: String(row.label),
    created_epoch: Number(row.created_epoch),
    last_seen_epoch: Number(row.last_seen_epoch),
    expires_epoch: row.expires_epoch === null ? null : Number(row.expires_epoch),
  };
}

function token_of(row: Row): Token {
  return {
    id: Number(row.id),
    name: String(row.name),
    owner: String(row.owner),
    read_only: Boolean(row.read_only),
    created_epoch: Number(row.created_epoch),
    last_used_epoch: row.last_used_epoch === null ? null : Number(row.last_used_epoch),
  };
}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function now_seconds(): number {
  return Math.floor(Date.now() / 1000);
}
