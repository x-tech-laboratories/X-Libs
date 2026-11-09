import { describe, expect, it } from "vitest";
import { ApiError, create_api } from "../src/web/api.ts";
import { follow_changes, type EventSourceLike } from "../src/web/events.ts";
import { LoginNeeded } from "../src/web/states.ts";
import { create_watch } from "../src/web/watch.ts";

function answering(status: number, body: string, seen: RequestInit[] = []): typeof fetch {
  return (async (_path: string, init: RequestInit) => {
    seen.push(init);
    return new Response(status === 204 ? null : body, { status });
  }) as typeof fetch;
}

describe("api", () => {
  it("sends a body as JSON with the extra headers and reads the JSON answer", async () => {
    const seen: RequestInit[] = [];
    const api = create_api({ fetch: answering(200, '{"ok":true}', seen), headers: () => ({ "x-client-id": "page-1" }) });

    const answer = await api<{ ok: boolean }>("/api/things", "POST", { name: "one" });

    expect(answer).toEqual({ ok: true });
    expect(seen[0].method).toBe("POST");
    expect(seen[0].body).toBe('{"name":"one"}');
    expect(seen[0].headers).toEqual({ accept: "application/json", "x-client-id": "page-1", "content-type": "application/json" });
  });

  it("answers nothing for a 204", async () => {
    expect(await create_api({ fetch: answering(204, "") })("/api/logout", "POST")).toBeUndefined();
  });

  it("throws LoginNeeded for a 401, except on an open path", async () => {
    const api = create_api({ fetch: answering(401, '{"error":"Wrong name or password."}'), open_paths: ["/api/login"] });

    await expect(api("/api/things")).rejects.toBeInstanceOf(LoginNeeded);
    await expect(api("/api/login", "POST", {})).rejects.toEqual(new ApiError("Wrong name or password.", 401));
  });

  it("throws the server's words from JSON or plain text", async () => {
    const json = create_api({ fetch: answering(409, '{"message":"Already running"}') });
    const text = create_api({ fetch: answering(404, "not found") });

    await expect(json("/api/x")).rejects.toMatchObject({ message: "Already running", status: 409 });
    await expect(text("/api/x")).rejects.toMatchObject({ message: "not found", status: 404 });
  });

  it("throws an ApiError with no status when the server cannot be reached", async () => {
    const api = create_api({ fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });

    await expect(api("/api/x")).rejects.toMatchObject({ message: "The server did not answer: Failed to fetch", status: null });
  });
});

class FakeSource implements EventSourceLike {
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onopen: ((event: Event) => void) | null = null;
  closed = false;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data = "") {
    this.listeners.get(type)?.(new MessageEvent(type, { data }));
  }
  close() {
    this.closed = true;
  }
}

describe("follow_changes", () => {
  it("keeps the client id, bumps on each change and on a reconnect, but not on the first open", () => {
    const source = new FakeSource();
    const feed = follow_changes("/api/events", { create: () => source });
    let bumps = 0;
    feed.watch.subscribe(() => bumps++);

    source.onopen?.(new Event("open"));
    source.emit("hello", "client-7");
    source.emit("changed");
    source.onopen?.(new Event("open"));
    feed.close();

    expect(feed.client_id()).toBe("client-7");
    expect(bumps).toBe(2);
    expect(source.closed).toBe(true);
  });

  it("bumps a watch the page holds", () => {
    const source = new FakeSource();
    const watch = create_watch();

    follow_changes("/api/events", { create: () => source, watch });
    source.emit("changed");

    expect(watch.version()).toBe(1);
  });
});
