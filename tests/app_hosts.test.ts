// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { desktop_api, is_android, is_desktop, web_api } from "../src/app/web/hosts.ts";
import { calls, data_watch, page, page_hooks, set_page_api } from "../src/app/web/page.ts";
import { LoginNeeded } from "../src/web/states.ts";
import { sample_app, sample_app_with_mcp } from "./app/sample_app.ts";

// ============================================================================
// Helpers
// ============================================================================

const window_keys: string[] = [];
const { bridges } = sample_app;

afterEach(() => {
  for (const key of window_keys.splice(0)) delete (window as unknown as Record<string, unknown>)[key];
  vi.unstubAllGlobals();
});

// Puts what the preload would expose on the window, the connections answering with the daemon in use.
function expose(current: string): { changed: () => void; send: (name: string, payload: unknown) => void } {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const exposed: Record<string, unknown> = {
    [bridges.calls.api_name]: { list_notes: vi.fn() },
    [bridges.device.api_name]: { get_sync_status: vi.fn() },
    [bridges.peer_listening.api_name]: { get_peer_listening: vi.fn() },
    [bridges.backups.api_name]: { list_backups: vi.fn() },
    [bridges.certificates.api_name]: { list_trusted_certificates: vi.fn() },
    [bridges.desktop.api_name]: { get_desktop_settings: vi.fn() },
    [bridges.connections.api_name]: { list_connections: vi.fn(async () => ({ connections: [], current })) },
    [bridges.local_mcp.api_name]: { get_local_mcp_settings: vi.fn() },
    [bridges.events.api_name]: { on: (event: string, given: (payload?: unknown) => void) => (listeners.set(event, given), () => undefined) },
  };
  Object.assign(window, exposed);
  window_keys.push(...Object.keys(exposed));
  return { changed: () => listeners.get("changed")?.(), send: (name, payload) => listeners.get(name)?.(payload) };
}

class FakeEventSource {
  static CLOSED = 2;
  static made: FakeEventSource[] = [];
  readyState = 1;
  listeners = new Map<string, (event: { data: string }) => void>();
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.made.push(this);
  }

  addEventListener(name: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(name, listener);
  }

  emit(name: string, data = ""): void {
    this.listeners.get(name)?.({ data });
  }
}

// ============================================================================
// Desktop
// ============================================================================

describe("desktop host", () => {
  it("is the desktop only where the preload put its calls", () => {
    expect(is_desktop(sample_app)).toBe(false);
    expose("local");
    expect(is_desktop(sample_app)).toBe(true);
  });

  it("offers this computer's sync and listening while its own daemon is in use", async () => {
    expose("local");

    const api = await desktop_api(sample_app);

    expect(api.host).toBe("desktop");
    expect(api.device).not.toBeNull();
    expect(api.peer_listening).toBeDefined();
    expect(api.connections).toBeDefined();
    expect(api.desktop).toBeDefined();
  });

  it("leaves device sync out on a server's daemon, and passes changes on", async () => {
    const { changed } = expose("home-server");
    const listener = vi.fn();

    const api = await desktop_api(sample_app);
    api.on_change(listener);
    changed();

    expect(api.device).toBeNull();
    expect(api.peer_listening).toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("offers the app's own MCP endpoint on this computer's daemon, when the app serves one", async () => {
    expose("local");

    expect((await desktop_api(sample_app_with_mcp)).local_mcp).toBeDefined();
    expect((await desktop_api(sample_app)).local_mcp).toBeUndefined();
    expose("home-server");
    expect((await desktop_api(sample_app_with_mcp)).local_mcp).toBeUndefined();
  });

  it("hands the page the app's own events by name", async () => {
    const { send } = expose("local");
    const listener = vi.fn();

    const api = await desktop_api(sample_app);
    api.on_event!("reply", listener);
    send("app_event", { event: "other", data: 1 });
    send("app_event", { event: "reply", data: { text: "Hello" } });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ text: "Hello" });
  });
});

// ============================================================================
// Web
// ============================================================================

describe("web host", () => {
  it("posts calls to the server with the client id it was given, and hears of changes and reconnects", async () => {
    FakeEventSource.made = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetch = vi.fn(async () => new Response(JSON.stringify([{ id: "note-1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const listener = vi.fn();

    const api = web_api(sample_app);
    api.on_change(listener);
    const events = FakeEventSource.made[0]!;
    events.emit("hello", "client-1");
    const notes = await api.calls.list_notes!();
    events.emit("changed");
    events.emit("hello", "client-2");

    expect(notes).toEqual([{ id: "note-1" }]);
    expect(fetch).toHaveBeenCalledWith("api/call/list_notes", expect.objectContaining({ headers: expect.objectContaining({ "x-client-id": "client-1" }) }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("hears the app's own events by name, on the stream now and after it reconnects", async () => {
    vi.useFakeTimers();
    FakeEventSource.made = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const listener = vi.fn();

    const api = web_api(sample_app);
    const stop = api.on_event!("reply", listener);
    const first = FakeEventSource.made[0]!;
    first.emit("reply", JSON.stringify({ text: "Hello" }));
    first.readyState = FakeEventSource.CLOSED;
    first.emit("error");
    vi.advanceTimersByTime(5000);
    FakeEventSource.made[1]!.emit("reply", JSON.stringify({ text: "Again" }));
    stop();
    FakeEventSource.made[1]!.emit("reply", JSON.stringify({ text: "Unheard" }));

    expect(listener.mock.calls).toEqual([[{ text: "Hello" }], [{ text: "Again" }]]);
    vi.useRealTimers();
  });

  it("follows the server's event stream again once the browser gave it up", async () => {
    vi.useFakeTimers();
    FakeEventSource.made = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    web_api(sample_app);
    const first = FakeEventSource.made[0]!;
    first.readyState = FakeEventSource.CLOSED;
    first.emit("error");
    vi.advanceTimersByTime(5000);

    expect(FakeEventSource.made).toHaveLength(2);
    vi.useRealTimers();
  });

  it("reaches the server's sync and backups, and asks to sign in when signed out", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn(async (path: string) => (path.startsWith("api/sync/") ? new Response("", { status: 401 }) : new Response(null, { status: 204 }))));

    const api = web_api(sample_app);

    expect(await api.backups!.create_backup()).toBeUndefined();
    await expect(api.device!.get_sync_status()).rejects.toBeInstanceOf(LoginNeeded);
  });

  it("passes on a server's refusal in its own words", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("That note does not exist.", { status: 400 })));

    await expect(web_api(sample_app).calls.list_notes!()).rejects.toThrow("That note does not exist.");
  });
});

// ============================================================================
// Phone and the page's api
// ============================================================================

describe("the page's api", () => {
  it("is on Android only where Capacitor says so", () => {
    expect(is_android()).toBe(false);
    vi.stubGlobal("Capacitor", { getPlatform: () => "android" });
    expect(is_android()).toBe(true);
  });

  it("bumps the data watch after a write and a change from elsewhere, but not after a read", async () => {
    let elsewhere = (): void => {};
    const list_notes = vi.fn(async () => []);
    const add_note = vi.fn(async () => "note-1");
    set_page_api({ host: "web", calls: { list_notes, add_note } as never, device: null, backups: null, on_change: (listener) => ((elsewhere = listener), () => undefined) });
    const bumped = vi.fn();
    data_watch.subscribe(bumped);

    await calls().list_notes!();
    expect(bumped).not.toHaveBeenCalled();
    await calls().add_note!("Groceries" as never);
    elsewhere();

    expect(bumped).toHaveBeenCalledTimes(2);
    expect(page().host).toBe("web");
    expect(page_hooks().calls()).toBe(calls());
  });
});
