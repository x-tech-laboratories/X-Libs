import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { create_window, is_app_page, is_external_link, type WindowOptions, type BrowserWindowLike, type BrowserWindowOptionsLike, type NativeThemeLike, type NavigationEventLike, type Rectangle } from "../../src/electron/window.ts";

// A stand-in for BrowserWindow that records what it was asked and lets a test fire its events.
class FakeWindow implements BrowserWindowLike {
  static last: FakeWindow;
  listeners = new Map<string, (() => void)[]>();
  open_handler: ((details: { url: string }) => { action: "deny" }) | undefined;
  bounds: Rectangle;
  maximized = false;
  shown = false;
  loaded = "";
  background = "";
  navigate_handler: ((event: NavigationEventLike, url: string) => void) | undefined;
  webContents = {
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: "deny" }) => { this.open_handler = handler; },
    on: (_event: "will-navigate", listener: (event: NavigationEventLike, url: string) => void) => { this.navigate_handler = listener; },
  };

  options: BrowserWindowOptionsLike;

  constructor(options: BrowserWindowOptionsLike) {
    this.options = options;
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height };
    FakeWindow.last = this;
  }

  on(event: string, listener: () => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  once(event: string, listener: () => void) { this.on(event, listener); }
  emit(event: string) { for (const listener of this.listeners.get(event) ?? []) listener(); }
  show() { this.shown = true; }
  maximize() { this.maximized = true; }
  isMaximized() { return this.maximized; }
  getNormalBounds() { return this.bounds; }
  setBackgroundColor(color: string) { this.background = color; }
  async loadURL(url: string) { this.loaded = url; }
  async loadFile(path: string) { this.loaded = path; }
}

function fake_theme(dark: boolean) {
  const listeners = new Set<() => void>();
  const theme: NativeThemeLike & { listeners: Set<() => void> } = {
    shouldUseDarkColors: dark,
    listeners,
    on: (_event, listener) => listeners.add(listener),
    removeListener: (_event, listener) => listeners.delete(listener),
  };
  return theme;
}

let folder = "";
let state_file = "";
const shell = { openExternal: vi.fn(async () => {}) };

function open(extra: { dev_url?: string; dark?: boolean; more?: Partial<WindowOptions> } = {}) {
  const native_theme = fake_theme(extra.dark ?? false);
  const window = create_window(FakeWindow, {
    title: "X-Notes", file: "/app/index.html", dev_url: extra.dev_url, default_size: { width: 1100, height: 700 }, min_size: { width: 640, height: 400 },
    preload: "/app/preload.mjs", state_file, native_theme, shell, ...extra.more,
  });
  return { window, native_theme };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "x-libs-window-"));
  state_file = join(folder, "state", "window.json");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  shell.openExternal.mockClear();
});

// Fires a navigation and says whether the window stopped it.
function navigate(window: FakeWindow, url: string): boolean {
  let is_stopped = false;
  window.navigate_handler!({ preventDefault: () => { is_stopped = true; } }, url);
  return is_stopped;
}

describe("create_window", () => {
  test("opens at the default size, hidden until ready, and loads the built page", () => {
    const { window } = open();

    expect(window.options).toMatchObject({ title: "X-Notes", width: 1100, height: 700, minWidth: 640, minHeight: 400, show: false, backgroundColor: "#f5f6f8" });
    expect(window.options.webPreferences).toEqual({ preload: "/app/preload.mjs", sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true });
    expect(window.options.titleBarStyle).toBeUndefined();
    expect(window.options.x).toBeUndefined();
    expect(window.loaded).toBe("/app/index.html");

    window.emit("ready-to-show");
    expect(window.shown).toBe(true);
  });

  test("loads the dev server when there is one", () => {
    expect(open({ dev_url: "http://localhost:5173" }).window.loaded).toBe("http://localhost:5173");
  });

  test("sends links to the browser instead of a new window", () => {
    const { window } = open();

    expect(window.open_handler!({ url: "https://example.org" })).toEqual({ action: "deny" });
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.org");
  });

  test("sends only web and mail links to the browser", () => {
    const { window } = open();

    window.open_handler!({ url: "file:///home/someone/notes.txt" });
    window.open_handler!({ url: "mailto:someone@example.org" });

    expect(shell.openExternal.mock.calls).toEqual([["mailto:someone@example.org"]]);
  });

  test("sends another app's links outside only when the app names its scheme", () => {
    open().window.open_handler!({ url: "stremio:///detail/movie/tt0111161" });
    expect(shell.openExternal).not.toHaveBeenCalled();

    const { window } = open({ more: { external_schemes: ["stremio:"] } });
    window.open_handler!({ url: "stremio:///detail/movie/tt0111161" });
    expect(navigate(window, "stremio:///detail/series/tt0903747")).toBe(true);
    window.open_handler!({ url: "file:///home/someone/notes.txt" });

    expect(shell.openExternal.mock.calls).toEqual([["stremio:///detail/movie/tt0111161"], ["stremio:///detail/series/tt0903747"]]);
  });

  test("keeps the app's own pages in the window and opens other sites in the browser", () => {
    const { window } = open();

    expect(navigate(window, "file:///app/index.html#/settings")).toBe(false);
    expect(navigate(window, "file:///app/other.html")).toBe(false);
    expect(navigate(window, "https://example.org/")).toBe(true);
    expect(navigate(window, "file:///home/someone/notes.txt")).toBe(true);

    expect(shell.openExternal.mock.calls).toEqual([["https://example.org/"]]);
  });

  test("treats the dev server's origin as the app's own", () => {
    expect(is_app_page("http://localhost:5173/#/search", { dev_url: "http://localhost:5173", file: "/app/index.html" })).toBe(true);
    expect(is_app_page("http://localhost:5174/", { dev_url: "http://localhost:5173", file: "/app/index.html" })).toBe(false);
    expect(is_external_link("javascript:alert(1)")).toBe(false);
    expect(is_external_link("not a url")).toBe(false);
  });

  test("follows the system theme until the window closes", () => {
    const { window, native_theme } = open({ dark: true });
    expect(window.options.backgroundColor).toBe("#0f1115");

    native_theme.shouldUseDarkColors = false;
    for (const listener of native_theme.listeners) listener();
    expect(window.background).toBe("#f5f6f8");

    window.emit("closed");
    expect(native_theme.listeners.size).toBe(0);
  });

  test("saves its place a moment after the last move, and at once on close", () => {
    const { window } = open();
    window.bounds = { x: 40, y: 50, width: 900, height: 600 };

    window.emit("move");
    window.emit("resize");
    expect(() => readFileSync(state_file)).toThrow();
    vi.advanceTimersByTime(500);
    expect(JSON.parse(readFileSync(state_file, "utf8"))).toEqual({ bounds: { x: 40, y: 50, width: 900, height: 600 }, is_maximized: false });

    window.maximized = true;
    window.emit("close");
    expect(JSON.parse(readFileSync(state_file, "utf8")).is_maximized).toBe(true);
  });

  test("reopens where it was, maximised again if it was", () => {
    open().window.emit("close");
    writeFileSync(state_file, JSON.stringify({ bounds: { x: 40, y: 50, width: 900, height: 600 }, is_maximized: true }));

    const { window } = open();
    window.emit("ready-to-show");

    expect(window.options).toMatchObject({ x: 40, y: 50, width: 900, height: 600 });
    expect(window.maximized).toBe(true);
  });

  test("ignores a broken state file", () => {
    open().window.emit("close");
    writeFileSync(state_file, "{ not json");

    expect(open().window.options).toMatchObject({ width: 1100, height: 700 });
  });

  test("keeps timers running while hidden and sets the title bar when asked", () => {
    const { window } = open({ more: { background_throttling: false, title_bar_style: "hiddenInset" } });

    expect(window.options.webPreferences.backgroundThrottling).toBe(false);
    expect(window.options.titleBarStyle).toBe("hiddenInset");
  });

  test("runs the write guard before each save, and skips a save it refuses", () => {
    const guarded: string[] = [];
    let refuse = true;
    const { window } = open({ more: { before_write: (path) => { guarded.push(path); if (refuse) throw new Error("read-only"); } } });

    expect(() => window.emit("close")).not.toThrow();
    expect(() => readFileSync(state_file)).toThrow();
    refuse = false;
    window.emit("close");

    expect(guarded).toEqual([state_file, state_file]);
    expect(JSON.parse(readFileSync(state_file, "utf8")).is_maximized).toBe(false);
  });
});
