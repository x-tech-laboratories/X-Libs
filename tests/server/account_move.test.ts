import { DatabaseSync } from "node:sqlite";

import { expect, it } from "vitest";

import { AccountStore, holds_accounts, move_accounts } from "../../src/server/account_store.ts";

// A made-up password for the throwaway user these tests make.
const test_password = "a made-up move password";

// The app's own database as an older version left it, its accounts kept beside its data.
function app_database_with_accounts(): { database: DatabaseSync; token: string } {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE notes (id TEXT PRIMARY KEY)");
  const accounts = new AccountStore({ database, app_name: "X-Sample", token_prefix: "cx" });
  accounts.create_user({ name: "ana", role: "admin", access: null, password: test_password });
  const { token } = accounts.create_token("ana", { name: "laptop", read_only: false });
  return { database, token };
}

it("moves users and tokens into their own database, where the old token still signs in", () => {
  const { database, token } = app_database_with_accounts();
  const accounts_database = new DatabaseSync(":memory:");

  expect(move_accounts(database, accounts_database)).toBe(true);

  const moved = new AccountStore({ database: accounts_database, app_name: "X-Sample", token_prefix: "cx" });
  expect(moved.users().map((user) => user.name)).toEqual(["ana"]);
  expect(moved.tokens().map((each) => each.name)).toEqual(["laptop"]);
  expect(token.startsWith("cx_")).toBe(true);
  expect(holds_accounts(database)).toBe(false);
  expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'notes'").get()).toBeDefined();
  expect(database.prepare("SELECT 1 FROM schema_versions WHERE owner = 'accounts'").get()).toBeUndefined();
});

it("leaves both alone when the accounts database already has accounts or the app's has none", () => {
  const { database } = app_database_with_accounts();
  const accounts_database = new DatabaseSync(":memory:");
  new AccountStore({ database: accounts_database, app_name: "X-Sample" });

  expect(move_accounts(database, accounts_database)).toBe(false);
  expect(holds_accounts(database)).toBe(true);
  expect(move_accounts(new DatabaseSync(":memory:"), new DatabaseSync(":memory:"))).toBe(false);
});
