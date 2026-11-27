import fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import fastify_cookie from "@fastify/cookie";
import { render_login_page } from "../../src/server/login_page.ts";
import { cookie_name_for, register_sign_in_guard, register_token_sign_in, session_value } from "../../src/server/sign_in.ts";
import { send_raw } from "./raw_request.ts";

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

  it("makes an address that sends too many wrong tokens wait, without counting the right ones", async () => {
    await build({ address_tries_allowed: 2 });
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    const post = (token: string, remoteAddress = "10.0.0.1") => app.inject({ method: "POST", url: "/login", payload: `token=${token}`, headers, remoteAddress });

    const statuses = [(await post("nope")).statusCode, (await post(secret)).statusCode, (await post(secret)).statusCode, (await post("nope")).statusCode];
    const refused = await post(secret);

    expect(statuses).toEqual([401, 303, 303, 401]);
    expect(refused.statusCode).toBe(429);
    expect(refused.body).toBe("Too many tries; wait a few minutes.");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect((await post(secret, "10.0.0.2")).statusCode).toBe(303);
  });

  it("takes the token as a bearer header", async () => {
    await build();
    expect((await app.inject({ method: "GET", url: "/api/things", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/things", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
  });

  it("makes an address that sends too many wrong bearer tokens wait, sharing the login page's limit", async () => {
    await build({ address_tries_allowed: 2 });
    const call = (authorization: string | undefined, remoteAddress = "10.0.0.1") =>
      app.inject({ method: "GET", url: "/api/things", remoteAddress, headers: authorization === undefined ? {} : { authorization } });

    const statuses = [];
    for (const authorization of [undefined, undefined, undefined, `Bearer ${secret}`, `Bearer ${secret}`, "Bearer fake-guess-one", "Bearer fake-guess-two"]) {
      statuses.push((await call(authorization)).statusCode);
    }
    const refused = await call(`Bearer ${secret}`);
    const login = await app.inject({ method: "POST", url: "/login", payload: `token=${secret}`, headers: { "content-type": "application/x-www-form-urlencoded" }, remoteAddress: "10.0.0.1" });

    expect(statuses).toEqual([401, 401, 401, 200, 200, 401, 401]);
    expect(refused.statusCode).toBe(429);
    expect(refused.body).toBe("Too many tries; wait a few minutes.");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(login.statusCode).toBe(429);
    expect((await call(`Bearer ${secret}`, "10.0.0.2")).statusCode).toBe(200);
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

describe("spelling of the path", () => {
  // A guard that leaves pages open, as apps with their own sign-in page use it, before two API routes and a page.
  async function guarded(options: Partial<Parameters<typeof register_sign_in_guard>[1]> = {}): Promise<FastifyInstance> {
    app = fastify();
    register_sign_in_guard(app, { is_signed_in: (request) => request.headers["x-user"] === "ann", login_path: null, refusal: "json", ...options });
    app.get("/api/zed", async () => "zed");
    app.post("/api/hosts/:name/actions/:action", async () => "done");
    app.get("/api/hosts/:name/events", async (request) => (request.params as { name: string }).name);
    app.get("/api/health", async () => "healthy");
    app.get("/", async () => "page");
    return app;
  }

  it("refuses an API route reached by escaping its letters, by any method", async () => {
    await guarded();

    expect(await send_raw(app, "GET", "/api/zed")).toMatchObject({ status: 401 });
    expect(await send_raw(app, "GET", "/%61pi/zed")).toMatchObject({ status: 400 });
    expect(await send_raw(app, "GET", "/api/%7Aed")).toMatchObject({ status: 400 });
    expect(await send_raw(app, "POST", "/%61pi/hosts/thor/actions/reboot")).toMatchObject({ status: 400 });
    expect(await send_raw(app, "POST", "/api/hosts/thor/actions/%72eboot")).toMatchObject({ status: 400 });
  });

  it("refuses fragments, absolute targets, and empty or dot segments", async () => {
    await guarded();

    for (const target of ["/api/zed#", "/x#/../api/zed", "http://localhost/api/zed", "//api/zed", "/./api/zed", "/api/../api/zed", "/api/hosts/%2E%2E/events"]) {
      expect((await send_raw(app, "GET", target)).status, target).toBe(400);
    }
  });

  it("never runs an API route signed out whatever else the path spells", async () => {
    await guarded();

    for (const target of ["/api%2Fzed", "/api%2fzed", "/%2561pi/zed", "/api;x=1/zed", "/api/zed;x=1", "/api/zed/", "/API/zed"]) {
      const answer = await send_raw(app, "GET", target);
      expect(answer.status, target).not.toBe(200);
      expect(answer.body, target).not.toBe("zed");
    }
  });

  it("judges by the router's reading when it ignores case, trailing slashes or what follows a semicolon", async () => {
    app = fastify({ routerOptions: { caseSensitive: false, ignoreTrailingSlash: true, useSemicolonDelimiter: true } as FastifyServerOptions["routerOptions"] });
    register_sign_in_guard(app, { is_signed_in: () => false, login_path: null });
    app.get("/api/zed", async () => "zed");

    for (const target of ["/API/zed", "/Api/Zed/", "/api/zed;x=1", "/api/zed/;x=1"]) {
      expect((await send_raw(app, "GET", target)).status, target).toBe(401);
    }
  });

  it("keeps open paths to their own spelling", async () => {
    await guarded({ open_paths: ["/api/health"], open_prefixes: ["/api/hosts/thor/"] });

    expect(await send_raw(app, "GET", "/api/health")).toMatchObject({ status: 200, body: "healthy" });
    expect(await send_raw(app, "GET", "/api/%68ealth")).toMatchObject({ status: 400 });
    expect(await send_raw(app, "GET", "/api/hosts/thor/events")).toMatchObject({ status: 200 });
    expect(await send_raw(app, "GET", "/api/hosts/%74hor/events")).toMatchObject({ status: 400 });
    expect(await send_raw(app, "GET", "/api/hosts/thor/../odin/events")).toMatchObject({ status: 400 });
  });

  it("serves plain requests, escaped spaces and slashes in a name, and escapes in the query", async () => {
    await guarded();
    const headers = { "x-user": "ann" };

    expect(await send_raw(app, "GET", "/", {})).toMatchObject({ status: 200, body: "page" });
    expect(await send_raw(app, "GET", "/api/zed?q=%61%25&next=%2F", headers)).toMatchObject({ status: 200, body: "zed" });
    expect(await send_raw(app, "GET", "/api/hosts/my%20host/events", headers)).toMatchObject({ status: 200, body: "my host" });
    expect(await send_raw(app, "GET", "/api/hosts/a%2Fb/events", headers)).toMatchObject({ status: 200, body: "a/b" });
    expect(await send_raw(app, "GET", "/api/hosts/caf%C3%A9/events", headers)).toMatchObject({ status: 200, body: "café" });
    expect(await send_raw(app, "GET", "/api/hosts/%2561/events", headers)).toMatchObject({ status: 200, body: "%61" });
    expect(await send_raw(app, "POST", "/api/hosts/thor/actions/reboot", headers)).toMatchObject({ status: 200, body: "done" });
  });

  it("refuses in the guard's own words, as text by default", async () => {
    await build();

    const answer = await send_raw(app, "GET", "/%61pi/things");

    expect(answer.status).toBe(400);
    expect(answer.body).toContain("Spell the path plainly");
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
