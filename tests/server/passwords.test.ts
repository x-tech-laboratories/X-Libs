import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hash_password, hash_password_async, load_accounts, parse_accounts, PasswordHashesBusy, PasswordHashSlots, set_account, verify_password, verify_password_async,
  type PasswordHasher,
} from "../../src/server/passwords.ts";

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

describe("asynchronous hashes", () => {
  it("agree with the synchronous ones on right, wrong and malformed hashes", async () => {
    const stored = await hash_password_async("correct horse");
    const cases: Array<[string, string]> = [
      ["correct horse", stored], ["wrong horse", stored], ["correct horse", hash_password("correct horse")],
      ["anything", "plain$text"], ["anything", "scrypt$zz$zz"], ["anything", "scrypt$abc$abcd"], ["anything", "scrypt$ab$"], ["anything", ""],
    ];

    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    for (const [password, hash] of cases) expect(await verify_password_async(password, hash)).toBe(verify_password(password, hash));
    expect(await verify_password_async("correct horse", stored)).toBe(true);
    expect(await verify_password_async("wrong horse", stored)).toBe(false);
    expect(verify_password("anything", "scrypt$zz$zz")).toBe(false);
  });
});

describe("password hash slots", () => {
  // A hasher whose every check waits until the test lets it finish.
  function slow_hasher() {
    const finishers: Array<() => void> = [];
    const hasher: PasswordHasher = {
      hash: async (password) => {
        await new Promise<void>((finish) => finishers.push(finish));
        return `hashed ${password}`;
      },
      verify: async (password, stored) => {
        await new Promise<void>((finish) => finishers.push(finish));
        return stored === `hashed ${password}`;
      },
    };
    return { hasher, finish_next: () => finishers.shift()?.(), waiting: () => finishers.length };
  }

  it("runs a few at once, queues a few more, and refuses the rest until a slot frees", async () => {
    const slow = slow_hasher();
    const slots = new PasswordHashSlots({ at_once: 1, waiting: 1, hasher: slow.hasher });

    const first = slots.verify("one", "hashed one");
    const second = slots.hash("two");
    const third = slots.verify("three", "hashed three");

    await expect(third).rejects.toBeInstanceOf(PasswordHashesBusy);
    await expect(third).rejects.toMatchObject({ statusCode: 429, retry_after_seconds: 1 });
    await Promise.resolve();
    expect(slow.waiting()).toBe(1);
    slow.finish_next();
    expect(await first).toBe(true);
    await new Promise((settle) => setImmediate(settle));
    expect(slow.waiting()).toBe(1);
    slow.finish_next();
    expect(await second).toBe("hashed two");
    const fourth = slots.verify("four", "wrong");
    await new Promise((settle) => setImmediate(settle));
    slow.finish_next();
    expect(await fourth).toBe(false);
  });

  it("uses scrypt off the main thread unless handed a hasher", async () => {
    const slots = new PasswordHashSlots();
    const stored = await slots.hash("correct horse");

    expect(await slots.verify("correct horse", stored)).toBe(true);
    expect(verify_password("correct horse", stored)).toBe(true);
  });
});
