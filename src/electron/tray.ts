// A desktop app's tray icon: a menu of rows the app works out as plain data, read again on a timer and whenever the app
// says its data changed, ending in the Show, Quit and Quit completely rows every app has.

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron the tray uses, so this module builds without Electron installed.
export interface TrayLike {
  on(event: "click", listener: () => void): unknown;
  setToolTip(text: string): void;
  setContextMenu(menu: never): void;
  destroy(): void;
  isDestroyed(): boolean;
}

export type MenuItemLike = { type: "separator" } | { label: string; enabled?: boolean; click: () => void };

export interface TrayElectronLike<Image> {
  Tray: new (image: Image) => TrayLike;
  Menu: { buildFromTemplate(template: MenuItemLike[]): unknown };
  nativeImage: { createFromPath(path: string): { resize(size: { width: number; height: number }): Image } };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

// One row of the menu: something to click, or a line between groups.
export type TrayRow = { kind: "item"; label: string; run: () => unknown; enabled?: boolean } | { kind: "separator" };

// What the tray shows at one moment.
export interface TrayView {
  tooltip: string;
  rows: TrayRow[];
}

// The rows every app ends its menu with; Quit completely is left out where there is no daemon to stop.
export interface AppCommands {
  app_name: string;
  show: () => unknown;
  quit: () => unknown;
  quit_completely?: () => unknown;
}

export function app_rows(commands: AppCommands): TrayRow[] {
  return [
    { kind: "item", label: `Show ${commands.app_name}`, run: commands.show },
    { kind: "item", label: "Quit", run: commands.quit },
    ...(commands.quit_completely ? [{ kind: "item" as const, label: "Quit completely", run: commands.quit_completely }] : []),
  ];
}

// The groups one after another with a line between each, leaving out the empty ones.
export function tray_groups(...groups: TrayRow[][]): TrayRow[] {
  return groups.filter((group) => group.length > 0).flatMap((group, index) => (index === 0 ? group : [{ kind: "separator" as const }, ...group]));
}

// A row's click is run apart from the menu, and its failure reported rather than thrown into Electron.
function menu_item(row: TrayRow, report: (error: unknown) => void): MenuItemLike {
  if (row.kind === "separator") return { type: "separator" };
  return {
    label: row.label,
    enabled: row.enabled ?? true,
    click: () => {
      try {
        void Promise.resolve(row.run()).catch(report);
      } catch (error) {
        report(error);
      }
    },
  };
}

// ── Tray ─────────────────────────────────────────────────────────────────────

export interface AppTrayOptions<Image> {
  // Electron's Tray, Menu and nativeImage.
  electron: TrayElectronLike<Image>;
  // The app's icon file, shrunk to the tray's size.
  icon_path: string;
  // What the tray shows now; a failure leaves the last menu in place.
  read: () => TrayView | Promise<TrayView>;
  // A click on the icon itself, usually showing the window.
  on_click: () => void;
  // How often the menu is read again, so times in it keep up; 5 seconds unless set.
  refresh_ms?: number;
  // Told when a read or a row's click failed.
  on_error?: (error: unknown) => void;
}

export interface AppTray {
  // Shows or takes away the icon, as the app's setting says.
  set_shown(is_shown: boolean): void;
  // While shown, closing the window leaves the app in the tray.
  is_shown(): boolean;
  // Reads the menu again at once, such as after the data changed.
  refresh(): Promise<void>;
  stop(): void;
}

const tray_icon_size = 22;

export function create_app_tray<Image>(options: AppTrayOptions<Image>): AppTray {
  const report = options.on_error ?? (() => {});
  let tray: TrayLike | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh(): Promise<void> {
    if (!tray || tray.isDestroyed()) return;
    let view: TrayView;
    try {
      view = await options.read();
    } catch (error) {
      report(error);
      return;
    }
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(view.tooltip);
    tray.setContextMenu(options.electron.Menu.buildFromTemplate(view.rows.map((row) => menu_item(row, report))) as never);
  }

  function stop(): void {
    clearInterval(timer);
    tray?.destroy();
    tray = null;
  }

  function start(): void {
    const image = options.electron.nativeImage.createFromPath(options.icon_path).resize({ width: tray_icon_size, height: tray_icon_size });
    tray = new options.electron.Tray(image);
    tray.on("click", options.on_click);
    void refresh();
    timer = setInterval(() => void refresh(), options.refresh_ms ?? 5000);
  }

  return {
    set_shown: (is_shown) => {
      if (is_shown && !tray) start();
      if (!is_shown && tray) stop();
    },
    is_shown: () => tray !== null,
    refresh,
    stop,
  };
}
