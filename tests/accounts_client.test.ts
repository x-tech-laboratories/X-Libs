import { describe, expect, it } from "vitest";

import { create_accounts_client } from "../src/web/accounts.ts";

// A fetch keeping each request as "METHOD path body" and answering with an empty object.
function recording() {
  const sent: string[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push(`${init.method ?? "GET"} ${url}${init.body ? ` ${String(init.body)}` : ""}`);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

describe("the accounts client", () => {
  it("reaches each account and user route under its base, names escaped", async () => {
    const { sent, fetch } = recording();
    const client = create_accounts_client({ base: "https://server.example/api/", fetch });
    await client.sign_in_device({ name: "ana", password: "word", device: "Phone" });
    await client.sign_out();
    await client.change_password("old", "new");
    await client.start_totp();
    await client.confirm_totp("123456");
    await client.disable_totp("123456");
    await client.sessions();
    await client.close_session(4);
    await client.close_other_sessions();
    await client.own_tokens();
    await client.create_token("cli", true);
    await client.create_token("ci", false, "read", 30);
    await client.token_scopes();
    await client.delete_own_token(7);
    await client.users();
    await client.create_user({ name: "bo", role: "user" } as never);
    await client.update_user("bo b", { role: "admin" } as never);
    await client.delete_user("bo b");
    await client.reset_totp("bo");
    await client.sign_user_out("bo");
    await client.all_tokens();
    await client.delete_token(9);
    const base = "https://server.example/api";
    expect(sent.map((line) => line.replace(base, ""))).toEqual([
      'POST /login {"name":"ana","password":"word","device":"Phone"}',
      "POST /logout",
      'PUT /account/password {"current":"old","next":"new"}',
      "POST /account/totp/start {}",
      'POST /account/totp/confirm {"code":"123456"}',
      'POST /account/totp/disable {"code":"123456"}',
      "GET /account/sessions",
      "DELETE /account/sessions/4",
      "DELETE /account/sessions",
      "GET /account/tokens",
      'POST /account/tokens {"name":"cli","read_only":true}',
      'POST /account/tokens {"name":"ci","read_only":false,"scope":"read","days":30}',
      "GET /account/token_scopes",
      "DELETE /account/tokens/7",
      "GET /users",
      'POST /users {"name":"bo","role":"user"}',
      'PUT /users/bo%20b {"role":"admin"}',
      "DELETE /users/bo%20b",
      "POST /users/bo/totp/reset {}",
      "DELETE /users/bo/sessions",
      "GET /tokens",
      "DELETE /tokens/9",
    ]);
  });
});
