import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start_daemon } from "../src/app/daemon.ts";
import { run_desktop, type DesktopOptions, type ElectronLike } from "../src/app/desktop.ts";
import { daemon_socket_path } from "../src/local_daemon.ts";
import { run_preload } from "../src/app/preload.ts";
import { route_of_link } from "../src/app/links.ts";
import { sample_app, sample_app_with_mcp } from "./app/sample_app.ts";

// ============================================================================
// A fake Electron
// ============================================================================

let profile: string;
let main_dir: string;
let quitters: (() => void)[] = [];

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), "x-libs-app-desktop-"));
  main_dir = join(profile, "out", "main");
});

afterEach(() => {
  for (const quit of quitters.splice(0)) quit();
  rmSync(profile, { recursive: true, force: true });
});

class FakeWindow {
  static made: FakeWindow[] = [];
  static getAllWindows = (): FakeWindow[] => FakeWindow.made;

  options: unknown;
  focused = 0;
  webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), once: vi.fn(), send: vi.fn(), reload: vi.fn() };

  constructor(options: unknown) {
    this.options = options;
    FakeWindow.made.push(this);
  }

  on = vi.fn();
  once = vi.fn();
  show = vi.fn();
  removeMenu = vi.fn();
  maximize = vi.fn();
  isMaximized = () => false;
  getNormalBounds = () => ({ x: 0, y: 0, width: 1100, height: 760 });
  setBackgroundColor = vi.fn();
  loadURL = vi.fn(async () => undefined);
  loadFile = vi.fn(async () => undefined);
  isMinimized = () => false;
  isFocused = () => true;
  isVisible = () => true;
  restore = vi.fn();
  focus = () => void this.focused++;
}

class FakeTray {
  static made: FakeTray[] = [];
  menu: { label?: string; click?: () => void }[] = [];
  tooltip = "";
  destroyed = false;

  constructor() {
    FakeTray.made.push(this);
  }

  on = vi.fn();
  setToolTip = (text: string) => void (this.tooltip = text);
  setContextMenu = (menu: { label?: string; click?: () => void }[]) => void (this.menu = menu);
  destroy = () => void (this.destroyed = true);
  isDestroyed = () => this.destroyed;
}

interface Fake {
  electron: ElectronLike;
  handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
  listeners: Map<string, (...args: unknown[]) => void>;
  exit: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  error_box: ReturnType<typeof vi.fn>;
}

function fake_electron(): Fake {
  FakeWindow.made = [];
  FakeTray.made = [];
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const exit = vi.fn();
  const quit = vi.fn();
  const error_box = vi.fn();
  let user_data = profile;
  const electron = {
    app: {
      isPackaged: false,
      getAppPath: () => main_dir,
      getPath: () => user_data,
      setPath: (_name: string, path: string) => void (user_data = path),
      whenReady: async () => undefined,
      on: (event: string, listener: (...args: unknown[]) => void) => void listeners.set(event, listener),
      exit,
      quit,
      requestSingleInstanceLock: () => true,
    },
    BrowserWindow: FakeWindow,
    dialog: { showErrorBox: error_box },
    ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, listener), removeHandler: (channel: string) => void handlers.delete(channel) },
    nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), removeListener: vi.fn() },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    shell: { openExternal: vi.fn(async () => undefined) },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template: unknown) => template },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  } as unknown as ElectronLike;
  quitters.push(() => listeners.get("will-quit")?.());
  return { electron, handlers, listeners, exit, quit, error_box };
}

// The desktop settings the daemon answers with, and every call the window made to it.
function fake_daemon(settings: Record<string, boolean> = { show_tray_icon: false, keep_running_in_background: true, start_at_login: true }) {
  const calls: { path: string; args: unknown[] }[] = [];
  const call_daemon = vi.fn(async (_socket: string, path: string, args: unknown[] = []) => {
    calls.push({ path, args });
    if (path.endsWith("daemon/get_desktop_settings")) return settings;
    if (path.endsWith("call/list_notes")) return [{ id: "note-1", title: "Groceries" }];
    return undefined;
  });
  return { calls, call_daemon, start_daemon: vi.fn(async () => "started" as const), set_autostart: vi.fn() };
}

function run(fake: Fake, daemon: ReturnType<typeof fake_daemon>, options: Partial<DesktopOptions> = {}): void {
  run_desktop(sample_app, fake.electron, { main_dir, argv: [], env: {}, cwd: profile, start_daemon: daemon.start_daemon, call_daemon: daemon.call_daemon, set_autostart: daemon.set_autostart, ...options });
}

// A call from the app's own page.
const from_page = () => ({ senderFrame: { url: pathToFileURL(join(main_dir, "../renderer/index.html")).href } });

async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
}

// ============================================================================
// Desktop
// ============================================================================

describe("app desktop window", { timeout: 30_000 }, () => {
  it("starts the daemon on the profile's database, then opens one window and keeps its login entry", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();

    run(fake, daemon);
    await until(() => FakeWindow.made.length > 0);

    expect(daemon.start_daemon).toHaveBeenCalledWith(expect.objectContaining({ script: join(main_dir, "daemon.js"), env: expect.objectContaining({ X_SAMPLE_DB: join(profile, "sample.db") }) }));
    expect(FakeWindow.made[0]!.options).toMatchObject({ title: "X-Sample" });
    expect(daemon.set_autostart).toHaveBeenCalledWith(expect.objectContaining({ id: "x-sample-daemon", name: "X-Sample in the background" }), true);
  });

  it("passes the page's calls to this computer's daemon, and only from its own page", async () => {
    const database_path = join(profile, "dev-data", "sample.db");
    const daemon = await start_daemon(sample_app, { database_path, socket_path: daemon_socket_path({ app: "x-sample", data_file: database_path }), on_stopped: () => undefined, default_peer_port: 0 });
    quitters.push(() => void daemon?.shut_down());
    const fake = fake_electron();
    run(fake, fake_daemon(), { env: { X_SAMPLE_USER_DATA: "dev-data" } });
    await until(() => fake.handlers.size > 0);

    const added = await fake.handlers.get("x_sample:add_note")!(from_page(), "Groceries");
    const answer = await fake.handlers.get("x_sample:list_notes")!(from_page());
    const refused = await fake.handlers.get("x_sample:list_notes")!({ senderFrame: { url: "https://example.org/" } });

    expect(added).toMatchObject({ ok: true });
    expect(answer).toEqual({ ok: true, result: [expect.objectContaining({ title: "Groceries" })] });
    expect(refused).toMatchObject({ ok: false });
  });

  it("hands every window the events the daemon's services emit, by name", async () => {
    const database_path = join(profile, "dev-data", "sample.db");
    let emit: ((event: string, data: unknown) => void) | null = null;
    const daemon = await start_daemon(sample_app, {
      database_path,
      socket_path: daemon_socket_path({ app: "x-sample", data_file: database_path }),
      on_stopped: () => undefined,
      default_peer_port: 0,
      services: (context) => ((emit = context.emit), { stop: () => undefined }),
    });
    quitters.push(() => void daemon?.shut_down());
    const fake = fake_electron();
    run(fake, fake_daemon(), { env: { X_SAMPLE_USER_DATA: "dev-data" } });
    await until(() => FakeWindow.made.length > 0);

    const sent = () => FakeWindow.made.flatMap((window) => window.webContents.send.mock.calls).filter(([, message]) => (message as { name: string }).name === "app_event");
    for (let tries = 0; tries < 100 && sent().length === 0; tries++) {
      emit!("reply", { text: "Hello" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(sent()[0]).toEqual([sample_app.bridges.events.channel, { name: "app_event", payload: { event: "reply", data: { text: "Hello" } } }]);
  });

  it("saves a desktop setting on the daemon and takes the login entry away once it no longer runs in the background", async () => {
    const fake = fake_electron();
    const settings = { keep_running_in_background: true, start_at_login: true };
    const daemon = fake_daemon(settings);
    run(fake, daemon);
    await until(() => fake.handlers.size > 0);

    settings.keep_running_in_background = false;
    await fake.handlers.get("x_sample_desktop:set_desktop_setting")!(from_page(), "keep_running_in_background", false);

    expect(daemon.calls).toContainEqual({ path: expect.stringContaining("daemon/set_desktop_setting"), args: ["keep_running_in_background", false] });
    expect(daemon.set_autostart).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it("keeps a tray with the app's own rows above Show and Quit, and stays in it when the last window closes", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon({ show_tray_icon: true, keep_running_in_background: true, start_at_login: true });
    run(fake, daemon, { tray: async () => ({ tooltip: "X-Sample · 1 note", rows: [{ kind: "item", label: "1 note", run: () => undefined }] }) });
    await until(() => (FakeTray.made[0]?.menu.length ?? 0) > 0);

    fake.listeners.get("window-all-closed")!();

    expect(FakeTray.made[0]!.tooltip).toBe("X-Sample · 1 note");
    expect(FakeTray.made[0]!.menu.map((row) => row.label)).toEqual(["1 note", undefined, "Show X-Sample", "Quit", "Quit completely"]);
    expect(fake.quit).not.toHaveBeenCalled();
  });

  it("quits when the last window closes without a tray, and starts hidden only when there is one", async () => {
    const fake = fake_electron();
    run(fake, fake_daemon(), { argv: ["--hidden"] });
    await until(() => FakeWindow.made.length > 0);

    fake.listeners.get("window-all-closed")!();

    expect(FakeTray.made).toHaveLength(0);
    expect(fake.quit).toHaveBeenCalled();

    const tray_fake = fake_electron();
    run(tray_fake, fake_daemon({ show_tray_icon: true, keep_running_in_background: true, start_at_login: true }), { argv: ["--hidden"] });
    await until(() => FakeTray.made.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(FakeWindow.made).toHaveLength(0);
  });

  it("opens the window on the page a link names, once the page has loaded", async () => {
    const fake = fake_electron();
    run(fake, fake_daemon(), { argv: ["x-sample://note/note-1"], route_of_link: (link) => route_of_link("x-sample", link) });
    await until(() => FakeWindow.made[0]?.webContents.once.mock.calls.length === 1);

    FakeWindow.made[0]!.webContents.once.mock.calls[0]![1]();

    expect(FakeWindow.made[0]!.webContents.send).toHaveBeenCalledWith(sample_app.bridges.events.channel, { name: "app_event", payload: { event: "open", data: "#/note/note-1" } });
  });

  it("sizes the first window from the screen, tells the daemon while it is in front, and keeps a dev run off the declarations", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();
    run(fake, daemon, { env: { X_SAMPLE_USER_DATA: "dev-data" }, default_size: (area) => ({ width: area.width / 2, height: area.height / 2 }) });
    await until(() => FakeWindow.made.length > 0);

    const focus = FakeWindow.made[0]!.on.mock.calls.find(([event]) => event === "focus")![1] as () => void;
    focus();
    await until(() => daemon.calls.some((each) => each.path.endsWith("daemon/set_window_in_front")));

    expect(FakeWindow.made[0]!.options).toMatchObject({ width: 960, height: 540 });
    expect(daemon.calls).toContainEqual({ path: expect.stringContaining("daemon/set_window_in_front"), args: [true] });
    expect(daemon.start_daemon).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ X_SAMPLE_DECLARED_FILE: "", X_SAMPLE_ICON: join(main_dir, "../../resources/icon.png") }) }));
  });

  it("passes the page's MCP endpoint calls to the daemon only for an app that serves one", async () => {
    const fake = fake_electron();
    run_desktop(sample_app_with_mcp, fake.electron, { main_dir, argv: [], env: {}, cwd: profile, ...(({ calls, ...rest }) => rest)(fake_daemon()) });
    await until(() => fake.handlers.size > 0);
    const plain = fake_electron();
    run(plain, fake_daemon());
    await until(() => plain.handlers.size > 0);

    expect(fake.handlers.has("x_sample_local_mcp:get_local_mcp_settings")).toBe(true);
    expect(plain.handlers.has("x_sample_local_mcp:get_local_mcp_settings")).toBe(false);
  });

  it("quits completely, stopping the daemon too", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();
    run(fake, daemon);
    await until(() => fake.handlers.size > 0);

    await fake.handlers.get("x_sample_desktop:quit_completely")!(from_page());

    expect(daemon.calls.some((each) => each.path.endsWith("daemon/stop_daemon"))).toBe(true);
    expect(fake.quit).toHaveBeenCalled();
  });

  it("brings the window forward on a second launch, but not on one that only starts the daemon", async () => {
    const fake = fake_electron();
    run(fake, fake_daemon());
    await until(() => FakeWindow.made.length > 0);
    const window = FakeWindow.made[0]!;
    const focused = window.focused;

    fake.listeners.get("second-instance")!({}, ["x-sample", "--daemon"]);
    expect(window.focused).toBe(focused);

    fake.listeners.get("second-instance")!({}, ["x-sample"]);
    expect(window.focused).toBe(focused + 1);
  });

  it("quits with the last window, leaving the daemon running", () => {
    const fake = fake_electron();
    run(fake, fake_daemon());

    fake.listeners.get("window-all-closed")!();

    expect(fake.quit).toHaveBeenCalled();
  });

  it("says why it could not start when the daemon would not", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();
    daemon.start_daemon.mockRejectedValue(new Error("no socket"));

    run(fake, daemon);
    await until(() => fake.exit.mock.calls.length > 0);

    expect(fake.error_box).toHaveBeenCalledWith("X-Sample could not start", expect.stringContaining("no socket"));
    expect(fake.exit).toHaveBeenCalledWith(1);
  });

  it("starts only the daemon when the login entry runs it", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();

    run(fake, daemon, { argv: ["electron", ".", "--daemon"] });
    await until(() => fake.exit.mock.calls.length > 0);

    expect(daemon.start_daemon).toHaveBeenCalledOnce();
    expect(fake.exit).toHaveBeenCalledWith(0);
    expect(FakeWindow.made).toEqual([]);
  });

  it("ends with an error when the login entry's daemon would not start", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();
    daemon.start_daemon.mockRejectedValue(new Error("no socket"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    run(fake, daemon, { argv: ["--daemon"] });
    await until(() => fake.exit.mock.calls.length > 0);

    expect(fake.exit).toHaveBeenCalledWith(1);
  });

  it("keeps a dev run's data in its own folder and never writes the login entry", async () => {
    const fake = fake_electron();
    const daemon = fake_daemon();

    run(fake, daemon, { env: { X_SAMPLE_USER_DATA: "dev-data" } });
    await until(() => FakeWindow.made.length > 0);

    expect(daemon.start_daemon).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ X_SAMPLE_DB: join(profile, "dev-data", "sample.db") }), log_file: join(profile, "dev-data", "daemon.log") }));
    expect(daemon.set_autostart).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Preload
// ============================================================================

describe("app preload", () => {
  it("puts every bridge and the events on the page's window under the app's names", () => {
    const exposed: string[] = [];

    run_preload(sample_app, { contextBridge: { exposeInMainWorld: (name) => void exposed.push(name) }, ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() } });

    expect(exposed).toEqual(["x_sample", "x_sample_device", "x_sample_backups", "x_sample_certificates", "x_sample_peer_listening", "x_sample_desktop", "x_sample_connections", "x_sample_events"]);
  });
});
