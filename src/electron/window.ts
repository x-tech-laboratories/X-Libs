// An Electron app's main window: links open in the browser, the background follows the system theme, and its size and place are remembered.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron the window uses, so this module builds without Electron installed.
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserWindowOptionsLike {
  title: string;
  icon?: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  show: boolean;
  backgroundColor: string;
  webPreferences: { preload?: string; sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean };
}

export interface BrowserWindowLike {
  webContents: { setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void };
  on(event: string, listener: () => void): unknown;
  once(event: string, listener: () => void): unknown;
  show(): void;
  maximize(): void;
  isMaximized(): boolean;
  getNormalBounds(): Rectangle;
  setBackgroundColor(color: string): void;
  loadURL(url: string): Promise<void>;
  loadFile(path: string): Promise<void>;
}

export interface NativeThemeLike {
  shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): unknown;
  removeListener(event: "updated", listener: () => void): unknown;
}

export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

export interface ScreenLike {
  getAllDisplays(): { workArea: Rectangle }[];
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface Size {
  width: number;
  height: number;
}

export interface WindowOptions {
  title: string;
  icon?: string;
  preload?: string;
  // The dev server's address, loaded instead of file while it is set.
  dev_url?: string;
  // The built page, such as join(__dirname, "../renderer/index.html").
  file: string;
  default_size: Size;
  min_size?: Size;
  // A JSON file that keeps the window's size, place and whether it was maximised.
  state_file?: string;
  native_theme: NativeThemeLike;
  shell: ShellLike;
  // Lets a remembered place that is on no screen now fall back to the default.
  screen?: ScreenLike;
  // The background behind the page before it paints, for light and dark themes.
  background?: { light: string; dark: string };
  // An ES module preload needs the sandbox off.
  sandbox?: boolean;
  save_delay_ms?: number;
}

export interface WindowState {
  bounds: Rectangle;
  is_maximized: boolean;
}

const DEFAULT_BACKGROUND = { light: "#f5f6f8", dark: "#0f1115" };
const DEFAULT_SAVE_DELAY_MS = 500;

// ── State file ───────────────────────────────────────────────────────────────

// A missing, unreadable or malformed file reads as no saved state.
export function read_window_state(state_file: string): WindowState | null {
  try {
    const state = JSON.parse(readFileSync(state_file, "utf8")) as Partial<WindowState>;
    const bounds = state.bounds;
    const is_whole = (value: unknown) => Number.isInteger(value);
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(is_whole) || bounds.width <= 0 || bounds.height <= 0) return null;
    return { bounds, is_maximized: state.is_maximized === true };
  } catch {
    return null;
  }
}

// Writes beside the file and renames over it, so a crash mid-write never leaves half a file.
export function write_window_state(state_file: string, state: WindowState): void {
  mkdirSync(dirname(state_file), { recursive: true });
  const temporary_file = `${state_file}.tmp`;
  writeFileSync(temporary_file, JSON.stringify(state));
  renameSync(temporary_file, state_file);
}

function overlaps(first: Rectangle, second: Rectangle): boolean {
  return first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
}

// ── Window ───────────────────────────────────────────────────────────────────

export function create_window<Window extends BrowserWindowLike>(
  BrowserWindow: new (options: BrowserWindowOptionsLike) => Window,
  options: WindowOptions,
): Window {
  const background = options.background ?? DEFAULT_BACKGROUND;
  const background_color = () => options.native_theme.shouldUseDarkColors ? background.dark : background.light;
  const saved = options.state_file ? read_window_state(options.state_file) : null;
  const on_a_screen = saved && (!options.screen || options.screen.getAllDisplays().some((display) => overlaps(saved.bounds, display.workArea)));
  const size = saved?.bounds ?? options.default_size;

  const window = new BrowserWindow({
    title: options.title,
    icon: options.icon,
    ...(on_a_screen ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    width: size.width,
    height: size.height,
    minWidth: options.min_size?.width,
    minHeight: options.min_size?.height,
    show: false,
    backgroundColor: background_color(),
    webPreferences: { preload: options.preload, sandbox: options.sandbox ?? false, contextIsolation: true, nodeIntegration: false },
  });

  window.once("ready-to-show", () => {
    if (saved?.is_maximized) window.maximize();
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void options.shell.openExternal(url);
    return { action: "deny" };
  });

  const follow_theme = () => window.setBackgroundColor(background_color());
  options.native_theme.on("updated", follow_theme);
  window.on("closed", () => options.native_theme.removeListener("updated", follow_theme));

  if (options.state_file) remember_state(window, options.state_file, options.save_delay_ms ?? DEFAULT_SAVE_DELAY_MS);

  if (options.dev_url) void window.loadURL(options.dev_url);
  else void window.loadFile(options.file);

  return window;
}

// Saves a moment after the last move or resize, and at once when the window closes.
function remember_state(window: BrowserWindowLike, state_file: string, save_delay_ms: number): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save_now = () => {
    clearTimeout(timer);
    timer = undefined;
    write_window_state(state_file, { bounds: window.getNormalBounds(), is_maximized: window.isMaximized() });
  };
  const save_soon = () => {
    clearTimeout(timer);
    timer = setTimeout(save_now, save_delay_ms);
  };

  for (const event of ["resize", "move", "maximize", "unmaximize"]) window.on(event, save_soon);
  window.on("close", save_now);
}
