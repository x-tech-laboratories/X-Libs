import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hash_password, load_accounts, parse_accounts, set_account, verify_password } from "../../src/server/passwords.ts";

describe("passwords", () => {
  it("verifies the password a hash was made from, and no other", () => {
    const stored = hash_password("correct horse");

    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verify_password("correct horse", stored)).toBe(true);
    expect(verify_password("wrong horse", stored)).toBe(false);
    expect(verify_password("correct horse", "plain$text")).toBe(false);
  });

  it("reads one user per line, and a bare hash as admin", () => {
    const first = hash_password("one");
    const second = hash_password("two");

    const accounts = parse_accounts(`# users\n${first}\n\nuser:${second}\n`);

    expect([...accounts]).toEqual([["admin", first], ["user", second]]);
  });

  it("refuses a bad name, a line with no hash, and a user named twice", () => {
    const stored = hash_password("x");

    expect(() => parse_accounts(`Bad Name:${stored}`)).toThrow(/line 1: 'Bad Name' is not a user name/);
    expect(() => parse_accounts("user:plain")).toThrow(/line 1 does not hold a hash/);
    expect(() => parse_accounts(`user:${stored}\nuser:${stored}`)).toThrow(/line 2 names 'user' a second time/);
  });

  it("names the app's variable when the file is unset or holds nobody", () => {
    const empty = join(mkdtempSync(join(tmpdir(), "x-libs-accounts-")), "empty");
    writeFileSync(empty, "# nobody yet\n");

    expect(() => load_accounts("X_TEST_ACCOUNTS_FILE", "")).toThrow(/^X_TEST_ACCOUNTS_FILE is not set/);
    expect(() => load_accounts("X_TEST_ACCOUNTS_FILE", empty)).toThrow(/holds no users/);
  });

  it("replaces a user's own line, and a bare hash for admin, keeping the rest", () => {
    const old_admin = hash_password("old");
    const user = hash_password("user");

    const text = set_account(`${old_admin}\nuser:${user}\n`, "admin", "scrypt$new$hash");

    expect(text).toBe(`user:${user}\nadmin:scrypt$new$hash\n`);
    expect(set_account("", "user", "scrypt$a$b")).toBe("user:scrypt$a$b\n");
  });
});
