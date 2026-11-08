import { describe, expect, test, vi } from "vitest";

import { create_main_fetch, create_main_stream_fetch, create_page_fetch, create_page_stream_fetch, is_allowed_url, type FetchAnswer, type FetchRequest, type StreamChunk } from "../../src/electron/fetch.ts";

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

// ============================================================================
// Streaming
// ============================================================================

// Joins the two halves the way the bridge and events do, chunks delivered on their own ticks.
function streaming_pair(send: typeof fetch) {
  const handlers = new Set<(chunk: StreamChunk) => void>();
  const main = create_main_stream_fetch({ hosts: ["*.googlevideo.com"] }, (chunk) => { for (const handler of handlers) handler(chunk); }, send);
  const page_fetch = create_page_stream_fetch({
    start: main.start,
    cancel: main.cancel,
    on_chunk: (handler) => { handlers.add(handler); return () => void handlers.delete(handler); },
  });
  return { main, page_fetch };
}

function chunked_body(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const part = parts.shift();
      if (part === undefined) controller.close();
      else controller.enqueue(encoder.encode(part));
    },
  });
}

describe("streaming fetch", () => {
  test("the page's Response body arrives chunk by chunk as the main process reads it", async () => {
    const { page_fetch } = streaming_pair(async () => new Response(chunked_body(["seg", "ment", "s"]), { status: 200, headers: { "content-type": "video/mp4" } }));

    const response = await page_fetch("https://rr1---sn.googlevideo.com/videoplayback");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");

    const reader = response.body!.getReader();
    const seen: string[] = [];
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) seen.push(new TextDecoder().decode(chunk.value));

    expect(seen).toEqual(["seg", "ment", "s"]);
  });

  test("a bodiless status answers without a stream, and a refused URL never starts", async () => {
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const { page_fetch } = streaming_pair(send);

    expect((await page_fetch("https://rr1---sn.googlevideo.com/x")).body).toBeNull();
    await expect(page_fetch("https://example.com/")).rejects.toThrow("not allowed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("a failed body read reaches the page as a stream error", async () => {
    const broken = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("connection reset")); } });
    const { page_fetch } = streaming_pair(async () => new Response(broken, { status: 200 }));

    const response = await page_fetch("https://rr1---sn.googlevideo.com/x");

    await expect(response.text()).rejects.toThrow("connection reset");
  });

  test("aborting cancels the main process's read and errors the body", async () => {
    let seen_signal: AbortSignal | undefined;
    const endless = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const { page_fetch } = streaming_pair(async (_url, init) => { seen_signal = init?.signal ?? undefined; return new Response(endless, { status: 200 }); });
    const controller = new AbortController();

    const response = await page_fetch("https://rr1---sn.googlevideo.com/x", { signal: controller.signal });
    const reading = response.body!.getReader().read();
    controller.abort();

    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(seen_signal?.aborted).toBe(true);
  });
});
