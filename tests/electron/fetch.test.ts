import { describe, expect, test, vi } from "vitest";

import { create_main_fetch, create_page_fetch, is_allowed_url, type FetchAnswer, type FetchRequest } from "../../src/electron/fetch.ts";

const policy = { hosts: ["www.youtube.com", "*.googlevideo.com"] };

// ============================================================================
// Main process
// ============================================================================

describe("is_allowed_url", () => {
  test("lets through https to the listed hosts and their wildcard subdomains", () => {
    expect(is_allowed_url("https://www.youtube.com/youtubei/v1/search", policy)).toBe(true);
    expect(is_allowed_url("https://rr3---sn-abc.googlevideo.com/videoplayback", policy)).toBe(true);
  });

  test("refuses other hosts, lookalikes, plain http and junk", () => {
    expect(is_allowed_url("https://evil.example.com/", policy)).toBe(false);
    expect(is_allowed_url("https://googlevideo.com/x", policy)).toBe(false);
    expect(is_allowed_url("https://notgooglevideo.com/x", policy)).toBe(false);
    expect(is_allowed_url("https://googlevideo.com.evil.test/x", policy)).toBe(false);
    expect(is_allowed_url("http://www.youtube.com/", policy)).toBe(false);
    expect(is_allowed_url("file:///home/someone/notes.txt", policy)).toBe(false);
    expect(is_allowed_url("not a url", policy)).toBe(false);
  });

  test("lets plain http through when allowed, matching a host with its port", () => {
    expect(is_allowed_url("http://localhost:7700/api/health", { hosts: ["localhost:7700"], allow_http: true })).toBe(true);
    expect(is_allowed_url("http://localhost:7701/api/health", { hosts: ["localhost:7700"], allow_http: true })).toBe(false);
  });
});

describe("create_main_fetch", () => {
  test("sends the request and answers with its status, headers and bytes", async () => {
    const send = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("hello", { status: 201, statusText: "Created", headers: { "content-type": "text/plain", "content-encoding": "identity" } }));
    const main_fetch = create_main_fetch(policy, send);
    const body = new TextEncoder().encode("{}");

    const answer = await main_fetch({ url: "https://www.youtube.com/x", method: "POST", headers: [["origin", "https://www.youtube.com"]], body });

    expect(send).toHaveBeenCalledWith("https://www.youtube.com/x", { method: "POST", headers: [["origin", "https://www.youtube.com"]], body });
    expect(answer.status).toBe(201);
    expect(answer.status_text).toBe("Created");
    expect(answer.headers).toEqual([["content-type", "text/plain"]]);
    expect(new TextDecoder().decode(answer.body!)).toBe("hello");
  });

  test("answers a bodiless status without a body", async () => {
    const main_fetch = create_main_fetch(policy, async () => new Response(null, { status: 204 }));

    expect((await main_fetch({ url: "https://www.youtube.com/x", method: "GET", headers: [] })).body).toBeNull();
  });

  test("refuses a URL outside the policy without sending it", async () => {
    const send = vi.fn(async () => new Response("never"));

    await expect(create_main_fetch(policy, send)({ url: "https://example.com/", method: "GET", headers: [] })).rejects.toThrow("not allowed");
    expect(send).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Page
// ============================================================================

function answer_with(text: string, status = 200): FetchAnswer {
  return { status, status_text: "OK", headers: [["content-type", "application/json"]], body: new TextEncoder().encode(text) };
}

describe("create_page_fetch", () => {
  test("pins headers over the caller's and keeps the rest", async () => {
    const send = vi.fn(async (_request: FetchRequest) => answer_with("{}"));
    const page_fetch = create_page_fetch(send, { pinned_headers: { Origin: "https://www.youtube.com" } });

    await page_fetch("https://www.youtube.com/x", { headers: { Origin: "http://localhost:5173", "X-Goog-Visitor-Id": "abc" } });

    const headers = new Headers(send.mock.calls[0]![0].headers);
    expect(headers.get("origin")).toBe("https://www.youtube.com");
    expect(headers.get("x-goog-visitor-id")).toBe("abc");
  });

  test("reads the body into bytes, and sends none for GET", async () => {
    const send = vi.fn(async (_request: FetchRequest) => answer_with("{}"));
    const page_fetch = create_page_fetch(send);

    await page_fetch("https://www.youtube.com/x", { method: "POST", body: '{"query":"lofi"}' });
    await page_fetch("https://www.youtube.com/y");

    expect(new TextDecoder().decode(send.mock.calls[0]![0].body)).toBe('{"query":"lofi"}');
    expect(send.mock.calls[1]![0].body).toBeUndefined();
  });

  test("answers with a Response the caller can read", async () => {
    const response = await create_page_fetch(async () => answer_with('{"ok":true}', 201))("https://www.youtube.com/x");

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("rejects as aborted once the caller's signal aborts", async () => {
    const controller = new AbortController();
    const pending = create_page_fetch(() => new Promise<FetchAnswer>(() => {}))("https://www.youtube.com/x", { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toThrow("aborted");
  });
});
