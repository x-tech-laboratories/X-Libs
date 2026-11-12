import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  bearer_of, match_declared_token, new_declared_token, parse_token_hash, read_declared_tokens, token_hash, type DeclaredTokenOptions,
} from "../../src/server/declared_tokens.ts";

const secret = "a-long-enough-secret-token";

function options(problems: string[] = []): DeclaredTokenOptions {
  return {
    scopes: { read: { role: "viewer", read_only: true }, control: { role: "operator", read_only: false }, push: { role: null, read_only: false, limitable: true } },
    limit_key: "monitors", new_token_command: "app token new",
    warn: (message) => problems.push(`warn: ${message}`), error: (message) => problems.push(`error: ${message}`),
  };
}

describe("declared tokens", () => {
  it("reads each form of the secret and maps the scope onto a role", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tokens-")), "token");
    writeFileSync(file, `${secret}-file\n`);
    const problems: string[] = [];
    const tokens = read_declared_tokens([
      { name: "scraper", scope: "read", token_hash: token_hash(secret) },
      { name: "ci", scope: "control", token_file: file },
      { name: "cron", scope: "push", token: `${secret}-inline`, monitors: "backup" },
    ], options(problems));
    expect(tokens.map((token) => [token.name, token.role, token.read_only, token.limited_to])).toEqual([
      ["scraper", "viewer", true, null], ["ci", "operator", false, null], ["cron", null, false, ["backup"]],
    ]);
    expect(problems).toEqual(["warn: token \"cron\" is written in plaintext in the config; use token_hash (from 'app token new') or token_file instead."]);
  });

  it("skips and explains every unusable entry", () => {
    const problems: string[] = [];
    const tokens = read_declared_tokens([
      "nope", { scope: "read" }, { name: "a", scope: "admin", token: secret }, { name: "b", scope: "read", token_hash: "sha256:xyz" },
      { name: "c", scope: "read" }, { name: "d", scope: "read", token: "short" }, { name: "e", scope: "read", token_file: "/no/such" },
      { name: "f", scope: "read", token_hash: token_hash(secret) }, { name: "f", scope: "read", token_hash: token_hash(`${secret}2`) },
      { name: "g", scope: "control", token_hash: token_hash(secret) }, { name: "h", scope: "read", token_hash: token_hash(`${secret}3`), monitors: ["x"] },
    ], options(problems));
    expect(tokens.map((token) => token.name)).toEqual(["f", "h"]);
    expect(tokens[1]!.limited_to).toBeNull();
    expect(problems).toEqual([
      "error: each token entry must be a mapping, got \"nope\"",
      "error: a token entry has no name; skipping it",
      "error: token \"a\" has scope \"admin\"; expected one of read, control, push",
      "error: token \"b\" has a malformed token_hash; expected sha256:<64 hex digits>",
      "error: token \"c\" needs token_hash, token_file or token",
      "warn: token \"d\" is written in plaintext in the config; use token_hash (from 'app token new') or token_file instead.",
      "error: token \"d\" is shorter than 16 characters",
      expect.stringMatching(/^error: could not read token_file \/no\/such for token "e": /),
      "error: token name \"f\" is used twice; skipping the second",
      "error: token \"g\" has the same secret as another token; skipping it",
      "warn: token \"h\" lists monitors, which only a push token uses; ignoring them",
    ]);
    expect(read_declared_tokens({ not: "a list" }, options(problems))).toEqual([]);
    expect(problems.at(-1)).toBe("error: the token list must be a list; no tokens are enabled");
  });

  it("matches a presented token by its digest", () => {
    const tokens = read_declared_tokens([{ name: "scraper", scope: "read", token_hash: token_hash(secret).toUpperCase().replace("SHA256:", "") }], options());
    expect(match_declared_token(tokens, secret)?.name).toBe("scraper");
    expect(match_declared_token(tokens, "wrong")).toBeNull();
    expect(match_declared_token(tokens, null)).toBeNull();
  });

  it("makes prefixed tokens and reads hashes and bearer headers", () => {
    expect(new_declared_token("xm_")).toMatch(/^xm_[A-Za-z0-9_-]{43}$/);
    expect(parse_token_hash(`sha256:${"A".repeat(64)}`)).toBe("a".repeat(64));
    expect(parse_token_hash("sha256:12")).toBeNull();
    expect(bearer_of("Bearer  abc ")).toBe("abc");
    expect(bearer_of("Basic abc")).toBeNull();
    expect(bearer_of("Bearer")).toBeNull();
    expect(bearer_of(undefined)).toBeNull();
  });
});
