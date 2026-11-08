import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import fastify_cookie from "@fastify/cookie";
import { render_login_page } from "../../src/server/login_page.ts";
import { cookie_name_for, register_sign_in_guard, register_token_sign_in, session_value } from "../../src/server/sign_in.ts";

const secret = "open-sesame";
let app: FastifyInstance;

async function build(options: Partial<Parameters<typeof register_token_sign_in>[1]> = {}): Promise<FastifyInstance> {
  app = fastify();
  await register_token_sign_in(app, { secret, title: "X-Test", failed_login_delay_ms: 0, ...options });
  app.get("/", async () => "page");
  app.get("/api/things", async () => ({ things: [] }));
  app.get("/api/health", async () => ({ ok: true }));
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe("token sign-in", () => {
  it("sends a page load to the login page and refuses an API call in plain text", async () => {
    await build();
    const page = await app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe("/login");
    const call = await app.inject({ method: "GET", url: "/api/things" });
    expect(call.statusCode).toBe(401);
    expect(call.headers["content-type"]).toContain("text/plain");
    expect(call.body).toBe("sign in first");
    expect(call.headers["cache-control"]).toBe("no-store");
  });

  it("lets a preflight and the open paths through", async () => {
    await build({ open_paths: ["/api/health"] });
    expect((await app.inject({ method: "OPTIONS", url: "/api/things" })).statusCode).not.toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });

  it("signs a browser in with the right token and keeps it signed in by cookie", async () => {
    await build();
    const login = await app.inject({ method: "POST", url: "/login", payload: "token=open-sesame", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(login.statusCode).toBe(303);
    expect(login.headers.location).toBe("/");
    const cookie = login.cookies.find((candidate) => candidate.name === "x_test_session")!;
    expect(cookie.value).toBe(session_value(secret, "x_test_session"));
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    const call = await app.inject({ method: "GET", url: "/api/things", cookies: { x_test_session: cookie.value } });
    expect(call.statusCode).toBe(200);
  });

  it("refuses a wrong token with the page saying so, and a forged cookie", async () => {
    await build();
    const login = await app.inject({ method: "POST", url: "/login", payload: "token=nope", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(login.statusCode).toBe(401);
    expect(login.body).toContain("That token is not right.");
    const call = await app.inject({ method: "GET", url: "/api/things", cookies: { x_test_session: "forged" } });
    expect(call.statusCode).toBe(401);
  });

  it("takes the token as a bearer header", async () => {
    await build();
    expect((await app.inject({ method: "GET", url: "/api/things", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/things", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
  });

  it("signs out by clearing the cookie", async () => {
    await build();
    const logout = await app.inject({ method: "GET", url: "/logout" });
    expect(logout.statusCode).toBe(303);
    expect(logout.headers.location).toBe("/login");
    expect(logout.cookies.find((candidate) => candidate.name === "x_test_session")?.value).toBe("");
  });

  it("leaves everything open without a secret", async () => {
    await build({ secret: "" });
    expect((await app.inject({ method: "GET", url: "/api/things" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
  });

  it("shows the login page with the app's title", async () => {
    await build();
    const page = await app.inject({ method: "GET", url: "/login" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("<h1>X-Test</h1>");
    expect(page.body).toContain('action="/login"');
  });

  it("answers in JSON and leaves pages alone when asked", async () => {
    await build({ refusal: "json", refusal_text: "Log in first.", login_path: "/api/login" });
    const call = await app.inject({ method: "GET", url: "/api/things" });
    expect(call.statusCode).toBe(401);
    expect(call.json()).toEqual({ error: "Log in first." });
  });
});

describe("sign-in guard", () => {
  it("takes the app's own check and leaves pages open with no login path", async () => {
    app = fastify();
    await app.register(fastify_cookie);
    register_sign_in_guard(app, { is_signed_in: (request) => request.headers["x-user"] === "ann", login_path: null, refusal: "json", refusal_text: "Log in first.", open_paths: ["/api/health"] });
    app.get("/", async () => "page");
    app.get("/api/things", async () => []);
    app.get("/api/health", async () => ({ ok: true }));
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const refused = await app.inject({ method: "GET", url: "/api/things" });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: "Log in first." });
    expect((await app.inject({ method: "GET", url: "/api/things", headers: { "x-user": "ann" } })).statusCode).toBe(200);
  });
});

describe("login page", () => {
  it("names the cookie after the title and escapes the page's text", () => {
    expect(cookie_name_for("X-Tasks")).toBe("x_tasks_session");
    const page = render_login_page({ title: "A <b>", has_failed: true, failure_text: "No & no" });
    expect(page).toContain("<title>A &lt;b&gt;</title>");
    expect(page).toContain("No &amp; no");
  });
});
