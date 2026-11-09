import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { hash_password } from "../../src/server/passwords.ts";
import { register_password_sign_in } from "../../src/server/password_sign_in.ts";
import { register_error_replies } from "../../src/server/replies.ts";

let app: FastifyInstance;

async function build(options: { tries_allowed?: number } = {}): Promise<FastifyInstance> {
  app = fastify();
  register_error_replies(app, { format: "json" });
  await register_password_sign_in(app, {
    accounts: new Map([["ada", hash_password("right")]]), cookie_name: "x_test_session", open_paths: ["/api/health"], ...options,
  });
  app.get("/api/things", async () => ({ things: [] }));
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/", async () => "page");
  return app;
}

function log_in(name: string, password: string) {
  return app.inject({ method: "POST", url: "/api/login", payload: { name, password } });
}

function session_cookie(response: Awaited<ReturnType<typeof log_in>>): string {
  return String(response.headers["set-cookie"]).split(";")[0];
}

afterEach(async () => {
  await app?.close();
});

describe("password sign-in", () => {
  it("refuses API calls without a session as JSON, and leaves the page and open paths alone", async () => {
    await build();

    const call = await app.inject({ method: "GET", url: "/api/things" });

    expect(call.statusCode).toBe(401);
    expect(call.json()).toEqual({ error: "Log in first." });
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
  });

  it("opens a session for the right name and password, whatever the name's case", async () => {
    await build();

    const login = await log_in(" Ada ", "right");
    const cookie = session_cookie(login);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(login.statusCode).toBe(204);
    expect(me.json()).toEqual({ logged_in: true, name: "ada" });
    expect((await app.inject({ method: "GET", url: "/api/things", headers: { cookie } })).statusCode).toBe(200);
  });

  it("refuses a wrong password and an unknown name alike", async () => {
    await build();

    const wrong = await log_in("ada", "wrong");
    const unknown = await log_in("bob", "right");

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("ends the session at logout", async () => {
    await build();
    const cookie = session_cookie(await log_in("ada", "right"));

    await app.inject({ method: "POST", url: "/api/logout", headers: { cookie } });

    expect((await app.inject({ method: "GET", url: "/api/things", headers: { cookie } })).statusCode).toBe(401);
  });

  it("makes an address wait after too many tries", async () => {
    await build({ tries_allowed: 2 });

    await log_in("ada", "wrong");
    await log_in("ada", "wrong");
    const third = await log_in("ada", "right");

    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ error: "Too many tries; wait a few minutes." });
  });
});
