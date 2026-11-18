import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { autostart_entry, autostart_file, exec_line, is_autostart_on, launch_command, set_autostart } from "../src/autostart.ts";

let config_dir: string;

beforeEach(() => {
  config_dir = mkdtempSync(join(tmpdir(), "autostart-"));
});

afterEach(() => {
  rmSync(config_dir, { recursive: true, force: true });
});

const options = () => ({ id: "x-tasks-daemon", name: "X-Tasks in the background", command: ["/opt/X Tasks/x-tasks", "--daemon"], config_dir });

describe("autostart entries", () => {
  it("writes and removes the entry", () => {
    expect(is_autostart_on(options())).toBe(false);
    set_autostart(options(), true);
    expect(autostart_file(options())).toBe(join(config_dir, "autostart", "x-tasks-daemon.desktop"));
    expect(readFileSync(autostart_file(options()), "utf8")).toBe(autostart_entry(options()));
    expect(is_autostart_on(options())).toBe(true);
    set_autostart(options(), false);
    expect(is_autostart_on(options())).toBe(false);
  });

  it("counts an entry the desktop's settings hid as off", () => {
    set_autostart(options(), true);
    writeFileSync(autostart_file(options()), `${autostart_entry(options())}Hidden=true\n`);
    expect(is_autostart_on(options())).toBe(false);
  });

  it("quotes arguments the desktop entry spec reserves and doubles percent signs", () => {
    expect(exec_line(["/opt/X Tasks/x-tasks", "--daemon"])).toBe('"/opt/X Tasks/x-tasks" --daemon');
    expect(exec_line(["app", "50%", 'say "$hi"'])).toBe('app 50%% "say \\"\\$hi\\""');
  });
});

describe("launch_command", () => {
  const saved = { FLATPAK_ID: process.env.FLATPAK_ID, APPIMAGE: process.env.APPIMAGE };
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("starts the app the way it was installed", () => {
    delete process.env.FLATPAK_ID;
    delete process.env.APPIMAGE;
    expect(launch_command({ launcher: "x-tasks", is_packaged: false, app_path: "/app", args: ["--daemon"] })).toEqual(["x-tasks", "--daemon"]);
    expect(launch_command({ is_packaged: false, app_path: "/app", args: ["--daemon"] })).toEqual([process.execPath, "/app", "--daemon"]);
    expect(launch_command({ is_packaged: true, app_path: "/app" })).toEqual([process.execPath]);
    process.env.APPIMAGE = "/home/someone/X-Tasks.AppImage";
    expect(launch_command({ is_packaged: true, app_path: "/app", args: ["--daemon"] })).toEqual(["/home/someone/X-Tasks.AppImage", "--daemon"]);
    process.env.FLATPAK_ID = "com.xtechlaboratories.xtasks";
    expect(launch_command({ is_packaged: true, app_path: "/app", args: ["--daemon"] })).toEqual(["flatpak", "run", "com.xtechlaboratories.xtasks", "--daemon"]);
  });
});
