import { createHmac } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressLockout, Debouncer, event_of, is_signed, parse_payload, read_push, register_webhook_route } from "../../src/server/forge_webhook.ts";

const secret = "shared-secret";
const body = Buffer.from('{"ref":"refs/heads/main"}');
const sign = (text: string, key = secret) => `sha256=${createHmac("sha256", key).update(text).digest("hex")}`;
const lower = (url: string) => url.toLowerCase();

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  vi.useRealTimers();
});

describe("signatures", () => {
  it("accept GitHub's HMAC, Forgejo's signature, a bearer token or GitLab's token", () => {
    expect(is_signed({ "x-hub-signature-256": sign(body.toString()) }, body, secret)).toBe(true);
    expect(is_signed({ "x-forgejo-signature": sign(body.toString()).slice("sha256=".length) }, body, secret)).toBe(true);
    expect(is_signed({ authorization: `Bearer ${secret}` }, body, secret)).toBe(true);
    expect(is_signed({ "x-gitlab-token": secret }, body, secret)).toBe(true);
  });

  it("refuse another key, another body or nothing", () => {
    expect(is_signed({ "x-hub-signature-256": sign(body.toString(), "other") }, body, secret)).toBe(false);
    expect(is_signed({ "x-hub-signature-256": sign("{}") }, body, secret)).toBe(false);
    expect(is_signed({ authorization: "Bearer wrong" }, body, secret)).toBe(false);
    expect(is_signed({}, body, secret)).toBe(false);
  });
});

describe("payloads", () => {
  it("name the event, push by default", () => {
    expect(event_of({ "x-github-event": "PING" })).toBe("ping");
    expect(event_of({})).toBe("push");
  });

  it("parse as JSON or as a form's payload field, and as null otherwise", () => {
    expect(parse_payload(Buffer.from('{"a":1}'), "application/json")).toEqual({ a: 1 });
    expect(parse_payload(Buffer.from(`payload=${encodeURIComponent('{"a":2}')}`), "application/x-www-form-urlencoded")).toEqual({ a: 2 });
    expect(parse_payload(Buffer.from("nope"), undefined)).toBeNull();
  });

  it("read as a push to a branch with the repository URLs normalised, and as null for a tag or a deleted branch", () => {
    const repository = { clone_url: "https://GitHub.com/Owner/Config.git", default_branch: "main" };

    expect(read_push({ ref: "refs/heads/staging", repository }, lower)).toEqual({
      repositories: new Set(["https://github.com/owner/config.git"]), branch: "staging", default_branch: "main",
    });
    expect(read_push({ ref: "refs/tags/v1", repository }, lower)).toBeNull();
    expect(read_push({ ref: "refs/heads/main", deleted: true, repository }, lower)).toBeNull();
    expect(read_push({ ref: "refs/heads/main", repository }, () => null)).toBeNull();
  });
});

describe("the lockout", () => {
  it("turns an address away after too many failures, until it waits or signs", () => {
    let now = 0;
    const lockout = new AddressLockout({ failures_allowed: 2, lockout_in_milliseconds: 1000, now: () => now });

    lockout.fail("a");
    expect(lockout.is_locked("a")).toBe(false);
    lockout.fail("a");
    expect(lockout.is_locked("a")).toBe(true);
    expect(lockout.is_locked("b")).toBe(false);
    now = 1001;
    expect(lockout.is_locked("a")).toBe(false);
    lockout.fail("a");
    lockout.succeed("a");
    lockout.fail("a");
    expect(lockout.is_locked("a")).toBe(false);
  });
});

describe("the debounce", () => {
  it("runs work once for a burst, and at once with no delay", () => {
    vi.useFakeTimers();
    const debounce = new Debouncer(10);
    const work = vi.fn();

    debounce.schedule("flake", work);
    debounce.schedule("flake", work);
    vi.advanceTimersByTime(9000);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(work).toHaveBeenCalledTimes(1);

    new Debouncer(0).schedule("now", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("drops what is waiting when closed", () => {
    vi.useFakeTimers();
    const debounce = new Debouncer(10);
    const work = vi.fn();

    debounce.schedule("flake", work);
    debounce.close();
    vi.advanceTimersByTime(20_000);

    expect(work).not.toHaveBeenCalled();
  });
});

describe("the route", () => {
  it("hands the exact raw body to the receiver and answers what it says, leaving other routes' parsing alone", async () => {
    app = fastify();
    const seen: Buffer[] = [];
    const closed = vi.fn();
    await register_webhook_route(app, { receive: (_address, _headers, raw) => (seen.push(raw), { status: 202, body: { message: "ok" } }), close: closed });
    app.post("/api/other", async (request) => request.body);

    const hook = await app.inject({ method: "POST", url: "/api/webhook", headers: { "content-type": "application/json" }, payload: '{ "ref" : 1 }' });
    const other = await app.inject({ method: "POST", url: "/api/other", payload: { a: 1 } });
    await app.close();
    app = null;

    expect(hook.statusCode).toBe(202);
    expect(hook.json()).toEqual({ message: "ok" });
    expect(seen[0].toString()).toBe('{ "ref" : 1 }');
    expect(other.json()).toEqual({ a: 1 });
    expect(closed).toHaveBeenCalled();
  });
});
