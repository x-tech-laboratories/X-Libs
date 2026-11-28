// The base app's desktop window: Electron's main process, which shows the app, keeps its login entry, and leaves the
// work to this computer's daemon or to a server chosen under Settings → Connections. The app hands in Electron, so this
// module builds without it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { unwatchFile, watchFile } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { launch_command, set_autostart, type AutostartOptions } from "../autostart.ts";
import { backup_method_names } from "../backups.ts";
import { certificate_method_names } from "../certificate_protocol.ts";
import { local_mcp_method_names } from "../local_mcp_protocol.ts";
import { create_certificate_trust } from "../certificates.ts";
import { connection_file_storage } from "../connection_file_storage.ts";
import { create_connections } from "../connections.ts";
import { create_daemon_link } from "../daemon_link.ts";
import { create_daemon_router, default_local_tables } from "../daemon_router.ts";
import { bring_to_front, first_argument, hold_single_instance, type AppLike, type FocusableWindowLike } from "../electron/app.ts";
import type { Implementation, IpcMainEventLike, IpcMainLike } from "../electron/bridge.ts";
import type { WindowLike } from "../electron/events.ts";
import { app_rows, create_app_tray, tray_groups, type AppTray, type TrayElectronLike, type TrayRow } from "../electron/tray.ts";
import { create_window, is_app_page, type BrowserWindowLike, type BrowserWindowOptionsLike, type NativeThemeLike, type ScreenLike, type ShellLike } from "../electron/window.ts";
import { call_daemon, daemon_log_path, daemon_socket_path, start_daemon } from "../local_daemon.ts";
import { peer_listening_method_names, sync_device_method_names } from "../sync_protocol.ts";
import type { App } from "./define.ts";
import { route_of_link } from "./links.ts";
import type { DesktopMethods, DesktopSettings } from "./protocol.ts";

// ── Electron's shapes ────────────────────────────────────────────────────────

type DesktopWindow = BrowserWindowLike &
  FocusableWindowLike &
  WindowLike & { webContents: { reload(): void; once(event: "did-finish-load", listener: () => void): unknown }; isFocused(): boolean; isVisible(): boolean };

// Only the parts of Electron the window uses.
export interface ElectronLike {
  app: AppLike & {
    isPackaged: boolean;
    getAppPath(): string;
    getPath(name: "userData"): string;
    setPath(name: "userData", path: string): void;
    whenReady(): Promise<unknown>;
    on(event: "will-quit" | "window-all-closed", listener: () => void): unknown;
    exit(code?: number): void;
  };
  BrowserWindow: (new (options: BrowserWindowOptionsLike) => DesktopWindow) & { getAllWindows(): DesktopWindow[] };
  dialog: { showErrorBox(title: string, content: string): void };
  ipcMain: IpcMainLike;
  nativeTheme: NativeThemeLike;
  screen: ScreenLike & { getPrimaryDisplay(): { workAreaSize: { width: number; height: number } } };
  shell: ShellLike;
  // Electron's Tray, Menu and nativeImage, for the tray icon; without them the app has none.
  Tray?: TrayElectronLike<unknown>["Tray"];
  Menu?: TrayElectronLike<unknown>["Menu"];
  nativeImage?: TrayElectronLike<unknown>["nativeImage"];
}

// What the app adds to its tray menu, above Show, Quit and Quit completely, worked out from its calls.
export interface TrayTools {
  // One of the app's calls on the daemon the window works on.
  call: (method: string, args?: unknown[]) => Promise<unknown>;
  // Brings the window forward on a page, such as "#/inbox".
  open: (route: string) => void;
}

export type AppTrayRows = (tools: TrayTools) => Promise<{ tooltip?: string; rows: TrayRow[] }>;

// ── Options ──────────────────────────────────────────────────────────────────

export interface DesktopOptions {
  // The built main process's folder, import.meta.dirname in the app's src/main/index.ts, which electron-vite builds
  // into out/main beside out/preload and out/renderer, with resources/ beside out/.
  main_dir: string;
  // The first window's size, or how to work it out from the screen's free area; the window keeps its size after.
  default_size?: { width: number; height: number } | ((work_area: { width: number; height: number }) => { width: number; height: number });
  min_size?: { width: number; height: number };
  // The command line, environment and folder dev runs are relative to, which a test hands in.
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  // A test hands in its own; the real ones unless set.
  start_daemon?: typeof start_daemon;
  call_daemon?: typeof call_daemon;
  set_autostart?: (options: AutostartOptions, on: boolean) => void;
  // The app's own tray rows, such as a count waiting or pages to open.
  tray?: AppTrayRows;
  // The page a link opens, where the app maps its links its own way; the app's link_scheme as "#/<path>" unless set.
  route_of_link?: (link: string) => string | null;
}

// ── Desktop ──────────────────────────────────────────────────────────────────

export function run_desktop(app: App, electron: ElectronLike, options: DesktopOptions): void {
  const { BrowserWindow, dialog, ipcMain } = electron;
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const prefix = app.env_prefix;
  const start = options.start_daemon ?? start_daemon;
  const call_socket = options.call_daemon ?? call_daemon;
  const write_autostart = options.set_autostart ?? set_autostart;

  // ── Profile ──────────────────────────────────────────────────────────

  // Dev runs set this so they never touch the installed app's data.
  const own_profile = env[`${prefix}_USER_DATA`];
  const is_own_profile = own_profile === undefined;
  if (!is_own_profile) electron.app.setPath("userData", join(options.cwd ?? process.cwd(), own_profile));

  const profile = electron.app.getPath("userData");
  const database_path = join(profile, app.database_file);

  // Any other profile gets a daemon, socket and log of its own, so a dev or test run never reaches the user's daemon.
  const socket_path = daemon_socket_path({ app: app.id, data_file: is_own_profile ? null : database_path });
  const log_file = is_own_profile ? daemon_log_path(app.id) : join(profile, "daemon.log");
  const icon_path = join(options.main_dir, "../../resources/icon.png");

  // The command that starts this app again, which the login entry runs.
  const own_command = (args: string[]): string[] =>
    launch_command({ launcher: env[`${prefix}_LAUNCHER`] ?? null, is_packaged: electron.app.isPackaged, app_path: electron.app.getAppPath(), args });

  function ensure_daemon(): Promise<unknown> {
    // Only the user's own daemon reads what this computer's configuration declares, unless a run names a file itself.
    const declared = is_own_profile ? {} : { [`${prefix}_DECLARED_FILE`]: env[`${prefix}_DECLARED_FILE`] ?? "" };
    return start({ socket_path, script: join(options.main_dir, "daemon.js"), env: { [`${prefix}_DB`]: database_path, [`${prefix}_SOCKET`]: socket_path, [`${prefix}_ICON`]: icon_path, ...declared }, log_file });
  }

  // ── Connections ──────────────────────────────────────────────────────

  // Certificates the user trusted, read again whenever the daemon saves the list, so calls to a server honour them.
  const certificates_file = join(profile, "trusted-certificates.json");
  const trust_certificates = (): void => void create_certificate_trust({ file: certificates_file, use_in_node: true });
  trust_certificates();
  watchFile(certificates_file, { interval: 2000 }, trust_certificates);

  // This computer's daemon, and servers each signed in once with a token of this device's own.
  const connections = create_connections({ storage: connection_file_storage(join(profile, "connections.json")), offers_local: true, device_name: `${app.name} on ${hostname()}` });
  const link = create_daemon_link({ connections, socket_path });
  const windows = (): DesktopWindow[] => BrowserWindow.getAllWindows();

  // Calls and change events go to the chosen daemon; another daemon chosen reloads every window.
  const router = create_daemon_router({
    connections,
    link,
    call_local: (path, args, headers) => call_socket(socket_path, path, args, headers),
    restart_local: ensure_daemon,
    local_tables: [...default_local_tables, "peer_listening"],
    is_read_only: app.is_read_only,
    on_change: () => {
      app.bridges.events.emit(windows(), "changed", null);
      void apply_window_settings().catch(() => undefined);
      void tray?.refresh();
    },
    on_sync_status: (status) => app.bridges.events.emit(windows(), "sync_status", status),
    // The app's own events, such as a reply as it is written, go to every window by name.
    on_event: (event, data) => app.bridges.events.emit(windows(), "app_event", { event, data: data === "" ? null : JSON.parse(data) }),
    on_switch: () => {
      for (const window of windows()) window.webContents.reload();
    },
  });
  const { call, forwarded } = router;

  // This computer's own settings, always from its own daemon.
  function get_desktop_settings(): Promise<DesktopSettings> {
    return call("daemon/get_desktop_settings") as Promise<DesktopSettings>;
  }

  // The tray as its setting says, and, for the user's own profile only, the login entry; a dev run never writes it.
  async function apply_window_settings(): Promise<void> {
    const settings = await get_desktop_settings();
    tray?.set_shown(settings.show_tray_icon);
    if (!is_own_profile) return;
    write_autostart(
      { id: `${app.id}-daemon`, name: `${app.name} in the background`, comment: `Sync and backups for ${app.name}`, icon: icon_path, command: own_command(["--daemon"]) },
      settings.start_at_login && settings.keep_running_in_background,
    );
  }

  // ── Window ───────────────────────────────────────────────────────────

  const page = {
    dev_url: electron.app.isPackaged ? undefined : env.ELECTRON_RENDERER_URL,
    file: join(options.main_dir, "../renderer/index.html"),
  };

  // The daemon's services keep quiet, such as about notifications, while a window is in front.
  function tell_in_front(): void {
    const in_front = windows().some((each) => each.isFocused() && each.isVisible());
    void call("daemon/set_window_in_front", [in_front]).catch(() => undefined);
  }

  function open_window(): DesktopWindow {
    const size = options.default_size ?? { width: 1100, height: 760 };
    const window = create_window(BrowserWindow, {
      ...page,
      title: app.name,
      icon: icon_path,
      // electron-vite emits an ESM preload as .mjs; loading .js here silently yields no bridge.
      preload: join(options.main_dir, "../preload/index.mjs"),
      default_size: typeof size === "function" ? size(electron.screen.getPrimaryDisplay().workAreaSize) : size,
      min_size: options.min_size ?? { width: 360, height: 480 },
      native_theme: electron.nativeTheme,
      shell: electron.shell,
      screen: electron.screen,
      state_file: join(profile, "window.json"),
    });
    for (const event of ["focus", "blur", "show", "hide", "closed"]) window.on(event, tell_in_front);
    return window;
  }

  // Brings the window forward, making one if it was closed, and hands it the route once its page listens.
  function show_window(route?: string | null): void {
    const existing = windows()[0];
    const window = existing ?? open_window();
    bring_to_front(window);
    if (!route) return;
    const open = () => app.bridges.events.emit([window], "app_event", { event: "open", data: route });
    if (existing) open();
    else window.webContents.once("did-finish-load", open);
  }

  // The page an argument such as x-notes://note/<id> opens, if the app has links.
  const link_route = options.route_of_link ?? (app.link_scheme ? (link: string) => route_of_link(app.link_scheme!, link) : () => null);
  const route_in = (args: readonly string[]): string | null => first_argument(args, link_route);

  // Stops the daemon as well, so nothing runs until the app is opened again.
  async function quit_completely(): Promise<void> {
    router.quitting();
    await call("daemon/stop_daemon").catch(() => undefined);
    electron.app.quit();
  }

  // ── Tray ───────────────────────────────────────────────────────────

  // The app's rows above Show, Quit and Quit completely; its calls go to the daemon the window works on.
  const { Tray, Menu, nativeImage } = electron;
  const tray: AppTray | null =
    Tray && Menu && nativeImage
      ? create_app_tray({
          electron: { Tray, Menu, nativeImage },
          icon_path,
          on_click: () => show_window(),
          on_error: (error) => console.error(error),
          read: async () => {
            const own = options.tray ? await options.tray({ call: (method, args = []) => call(`call/${method}`, args), open: (route) => show_window(route) }) : { rows: [] };
            const quit = (): void => {
              router.quitting();
              electron.app.quit();
            };
            return { tooltip: own.tooltip ?? app.name, rows: tray_groups(own.rows, app_rows({ app_name: app.name, show: () => show_window(), quit, quit_completely: () => void quit_completely() })) };
          },
        })
      : null;

  // ── Bridges ──────────────────────────────────────────────────────────

  // Only the app's own page may call in, never a site a link led to.
  function trusted(event: IpcMainEventLike): boolean {
    return is_app_page(event.senderFrame?.url ?? "", page);
  }

  // The page's calls go to the chosen daemon, but for the connections, quitting and the settings the window acts on.
  function register_bridges(): void {
    const handle_options = { trusted, envelopes: true };
    const { bridges } = app;
    // A write the page makes shows in the tray at once, as the daemon tells this window of no change it made itself.
    const calls = Object.fromEntries(
      Object.entries(forwarded(app.method_names, "call")).map(([name, forward]) => [
        name,
        async (...args: unknown[]) => {
          const result = await forward(...args);
          if (!app.is_read_only(name)) void tray?.refresh();
          return result;
        },
      ]),
    );
    bridges.calls.handle(ipcMain, calls as never, handle_options);
    bridges.backups.handle(ipcMain, forwarded(backup_method_names, "backups") as never, handle_options);
    bridges.device.handle(ipcMain, forwarded(sync_device_method_names, "device") as never, handle_options);
    bridges.peer_listening.handle(ipcMain, forwarded(peer_listening_method_names, "peer_listening") as never, handle_options);
    bridges.certificates.handle(ipcMain, forwarded(certificate_method_names, "certificates") as never, handle_options);
    bridges.connections.handle(ipcMain, connections.methods, handle_options);
    if (app.local_mcp) bridges.local_mcp.handle(ipcMain, forwarded(local_mcp_method_names, "local_mcp") as never, handle_options);
    const desktop: Implementation<DesktopMethods> = {
      get_desktop_settings,
      set_desktop_setting: async (key, value) => {
        await call("daemon/set_desktop_setting", [key, value]);
        await apply_window_settings();
      },
      quit_completely,
    };
    bridges.desktop.handle(ipcMain, desktop, handle_options);
  }

  // ── Start ────────────────────────────────────────────────────────────

  function start_app(): void {
    void electron.app.whenReady().then(async () => {
      try {
        await ensure_daemon();
      } catch (error) {
        dialog.showErrorBox(`${app.name} could not start`, `${error instanceof Error ? error.message : String(error)}\n\nSee ${log_file}.`);
        electron.app.exit(1);
        return;
      }
      register_bridges();
      router.start();
      await apply_window_settings().catch(() => undefined);
      // `--hidden`, as a login entry may pass it, starts in the tray, unless there is no tray to open the window from.
      if (!(argv.includes("--hidden") && tray?.is_shown())) show_window(route_in(argv));
    });

    electron.app.on("will-quit", () => {
      router.stop();
      tray?.stop();
      unwatchFile(certificates_file, trust_certificates);
    });

    // Closing the window ends only the window, or leaves the app in the tray; the daemon runs on either way.
    electron.app.on("window-all-closed", () => {
      if (!tray?.is_shown()) electron.app.quit();
    });
  }

  // `<app>-desktop --daemon`, as the login entry runs it, starts only the daemon.
  async function start_daemon_alone(): Promise<void> {
    try {
      await ensure_daemon();
      electron.app.exit(0);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      electron.app.exit(1);
    }
  }

  // A second launch brings the window forward on the page its link names, but one that only starts the daemon or
  // starts hidden leaves the window be.
  function open_from_second_launch(second_argv: string[]): void {
    if (!second_argv.includes("--daemon") && !second_argv.includes("--hidden")) show_window(route_in(second_argv));
  }

  if (argv.includes("--daemon")) void start_daemon_alone();
  else if (hold_single_instance(electron.app, open_from_second_launch)) start_app();
}
