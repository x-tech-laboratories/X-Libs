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
import { create_certificate_trust } from "../certificates.ts";
import { connection_file_storage } from "../connection_file_storage.ts";
import { create_connections } from "../connections.ts";
import { create_daemon_link } from "../daemon_link.ts";
import { create_daemon_router, default_local_tables } from "../daemon_router.ts";
import { bring_to_front, hold_single_instance, type AppLike, type FocusableWindowLike } from "../electron/app.ts";
import type { Implementation, IpcMainEventLike, IpcMainLike } from "../electron/bridge.ts";
import type { WindowLike } from "../electron/events.ts";
import { create_window, is_app_page, type BrowserWindowLike, type BrowserWindowOptionsLike, type NativeThemeLike, type ScreenLike, type ShellLike } from "../electron/window.ts";
import { call_daemon, daemon_log_path, daemon_socket_path, start_daemon } from "../local_daemon.ts";
import { peer_listening_method_names, sync_device_method_names } from "../sync_protocol.ts";
import type { App } from "./define.ts";
import type { DesktopMethods, DesktopSettings } from "./protocol.ts";

// ── Electron's shapes ────────────────────────────────────────────────────────

type DesktopWindow = BrowserWindowLike & FocusableWindowLike & WindowLike & { webContents: { reload(): void } };

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
  screen: ScreenLike;
  shell: ShellLike;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface DesktopOptions {
  // The built main process's folder, import.meta.dirname in the app's src/main/index.ts, which electron-vite builds
  // into out/main beside out/preload and out/renderer, with resources/ beside out/.
  main_dir: string;
  default_size?: { width: number; height: number };
  min_size?: { width: number; height: number };
  // The command line, environment and folder dev runs are relative to, which a test hands in.
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  // A test hands in its own; the real ones unless set.
  start_daemon?: typeof start_daemon;
  call_daemon?: typeof call_daemon;
  set_autostart?: (options: AutostartOptions, on: boolean) => void;
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
    return start({ socket_path, script: join(options.main_dir, "daemon.js"), env: { [`${prefix}_DB`]: database_path, [`${prefix}_SOCKET`]: socket_path }, log_file });
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

  // Only the user's own profile starts at login; a dev run never writes the login entry.
  async function apply_window_settings(): Promise<void> {
    if (!is_own_profile) return;
    const settings = await get_desktop_settings();
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

  function open_window(): DesktopWindow {
    return create_window(BrowserWindow, {
      ...page,
      title: app.name,
      icon: icon_path,
      // electron-vite emits an ESM preload as .mjs; loading .js here silently yields no bridge.
      preload: join(options.main_dir, "../preload/index.mjs"),
      default_size: options.default_size ?? { width: 1100, height: 760 },
      min_size: options.min_size ?? { width: 360, height: 480 },
      native_theme: electron.nativeTheme,
      shell: electron.shell,
      screen: electron.screen,
      state_file: join(profile, "window.json"),
    });
  }

  function show_window(): void {
    bring_to_front(windows()[0] ?? open_window());
  }

  // Stops the daemon as well, so nothing runs until the app is opened again.
  async function quit_completely(): Promise<void> {
    router.quitting();
    await call("daemon/stop_daemon").catch(() => undefined);
    electron.app.quit();
  }

  // ── Bridges ──────────────────────────────────────────────────────────

  // Only the app's own page may call in, never a site a link led to.
  function trusted(event: IpcMainEventLike): boolean {
    return is_app_page(event.senderFrame?.url ?? "", page);
  }

  // The page's calls go to the chosen daemon, but for the connections, quitting and the settings the window acts on.
  function register_bridges(): void {
    const handle_options = { trusted, envelopes: true };
    const { bridges } = app;
    bridges.calls.handle(ipcMain, forwarded(app.method_names, "call") as never, handle_options);
    bridges.backups.handle(ipcMain, forwarded(backup_method_names, "backups") as never, handle_options);
    bridges.device.handle(ipcMain, forwarded(sync_device_method_names, "device") as never, handle_options);
    bridges.peer_listening.handle(ipcMain, forwarded(peer_listening_method_names, "peer_listening") as never, handle_options);
    bridges.certificates.handle(ipcMain, forwarded(certificate_method_names, "certificates") as never, handle_options);
    bridges.connections.handle(ipcMain, connections.methods, handle_options);
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
      show_window();
    });

    electron.app.on("will-quit", () => {
      router.stop();
      unwatchFile(certificates_file, trust_certificates);
    });

    // Closing the window ends only the window; the daemon runs on.
    electron.app.on("window-all-closed", () => electron.app.quit());
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

  // A second launch brings the window forward, but one that only starts the daemon leaves the window be.
  function open_from_second_launch(second_argv: string[]): void {
    if (!second_argv.includes("--daemon")) show_window();
  }

  if (argv.includes("--daemon")) void start_daemon_alone();
  else if (hold_single_instance(electron.app, open_from_second_launch)) start_app();
}
