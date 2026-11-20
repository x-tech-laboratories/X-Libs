import { afterEach, describe, expect, test, vi } from "vitest";

import { app_rows, create_app_tray, tray_groups, type MenuItemLike, type TrayElectronLike, type TrayLike, type TrayView } from "../../src/electron/tray.ts";

afterEach(() => {
  vi.useRealTimers();
});

// Electron's tray, menu and images standing in, keeping the last tooltip and menu given.
function fake_electron() {
  const made: { tooltip: string; menu: MenuItemLike[]; destroyed: boolean; click?: () => void }[] = [];
  class FakeTray implements TrayLike {
    readonly state = { tooltip: "", menu: [] as MenuItemLike[], destroyed: false, click: undefined as (() => void) | undefined };
    readonly image: string;
    constructor(image: string) {
      this.image = image;
      made.push(this.state);
    }
    on(_event: "click", listener: () => void) {
      this.state.click = listener;
    }
    setToolTip(text: string) {
      this.state.tooltip = text;
    }
    setContextMenu(menu: never) {
      this.state.menu = menu;
    }
    destroy() {
      this.state.destroyed = true;
    }
    isDestroyed() {
      return this.state.destroyed;
    }
  }
  const electron: TrayElectronLike<string> = {
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (path) => ({ resize: ({ width }) => `${path}@${width}` }) },
  };
  return { electron, made };
}

const settle = () => new Promise((wake) => setTimeout(wake, 0));

describe("rows", () => {
  test("every app's rows end the menu, with Quit completely only where there is a daemon", () => {
    const run = () => undefined;

    expect(app_rows({ app_name: "X-Fitness", show: run, quit: run, quit_completely: run }).map((row) => row.kind === "item" && row.label)).toEqual(["Show X-Fitness", "Quit", "Quit completely"]);
    expect(app_rows({ app_name: "X-Music", show: run, quit: run }).map((row) => row.kind === "item" && row.label)).toEqual(["Show X-Music", "Quit"]);
  });

  test("groups are ruled off from each other and empty ones left out", () => {
    const row = (label: string) => ({ kind: "item" as const, label, run: () => undefined });

    expect(tray_groups([row("a")], [], [row("b"), row("c")]).map((item) => (item.kind === "item" ? item.label : "—"))).toEqual(["a", "—", "b", "c"]);
    expect(tray_groups([], [])).toEqual([]);
  });
});

describe("the tray", () => {
  test("shows the icon at the tray's size, reads its menu, and runs a row when clicked", async () => {
    const { electron, made } = fake_electron();
    const finish = vi.fn();
    const show = vi.fn();
    const tray = create_app_tray({
      electron,
      icon_path: "/icon.png",
      read: (): TrayView => ({ tooltip: "X-Fitness\nPush — 42:10", rows: [{ kind: "item", label: "Finish workout", run: finish }, { kind: "separator" }] }),
      on_click: show,
    });

    tray.set_shown(true);
    await settle();
    const [state] = made;
    (state!.menu[0] as { click: () => void }).click();
    state!.click!();

    expect(tray.is_shown()).toBe(true);
    expect(state!.tooltip).toBe("X-Fitness\nPush — 42:10");
    expect(state!.menu).toEqual([expect.objectContaining({ label: "Finish workout", enabled: true }), { type: "separator" }]);
    expect(finish).toHaveBeenCalled();
    expect(show).toHaveBeenCalled();
    tray.stop();
  });

  test("reads again on its timer, and goes away when the setting is turned off", async () => {
    vi.useFakeTimers();
    const { electron, made } = fake_electron();
    let reads = 0;
    const tray = create_app_tray({ electron, icon_path: "/icon.png", read: () => ({ tooltip: `read ${++reads}`, rows: [] }), on_click: () => undefined, refresh_ms: 1000 });

    tray.set_shown(true);
    tray.set_shown(true);
    await vi.advanceTimersByTimeAsync(2500);
    tray.set_shown(false);
    await vi.advanceTimersByTimeAsync(5000);

    expect(made).toHaveLength(1);
    expect(made[0]!.tooltip).toBe("read 3");
    expect(made[0]!.destroyed).toBe(true);
    expect(tray.is_shown()).toBe(false);
  });

  test("keeps the last menu when a read fails, and reports a failing click", async () => {
    const { electron, made } = fake_electron();
    const errors: unknown[] = [];
    let fail = false;
    const tray = create_app_tray({
      electron,
      icon_path: "/icon.png",
      read: () => {
        if (fail) throw new Error("the daemon is gone");
        return { tooltip: "fine", rows: [{ kind: "item", label: "Break", run: () => Promise.reject(new Error("refused")) }] };
      },
      on_click: () => undefined,
      on_error: (error) => errors.push((error as Error).message),
    });

    tray.set_shown(true);
    await settle();
    fail = true;
    await tray.refresh();
    (made[0]!.menu[0] as { click: () => void }).click();
    await settle();

    expect(made[0]!.tooltip).toBe("fine");
    expect(errors).toEqual(["the daemon is gone", "refused"]);
    tray.stop();
  });
});
