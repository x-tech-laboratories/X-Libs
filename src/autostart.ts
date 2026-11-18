// Starting part of an app when the user logs in, through an XDG autostart entry in ~/.config/autostart, which every
// Linux desktop reads. A desktop app's daemon is started this way, by `<app> --daemon`. The entry is written again on
// every start while it is on, so it follows the app when its file moves, such as an AppImage that was moved.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Entry ────────────────────────────────────────────────────────────────────

export interface AutostartOptions {
  // The entry's file name without ".desktop", such as "x-tasks-daemon".
  id: string;
  // The name a desktop's startup settings show, such as "X-Tasks in the background".
  name: string;
  // The program and its arguments, such as `launch_command(...)` with "--daemon".
  command: string[];
  comment?: string;
  // An icon theme name or a file.
  icon?: string;
  // The config folder; $XDG_CONFIG_HOME or ~/.config unless set.
  config_dir?: string;
}

export function autostart_file(options: Pick<AutostartOptions, "id" | "config_dir">): string {
  const config = options.config_dir ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(config, "autostart", `${options.id}.desktop`);
}

export function autostart_entry(options: AutostartOptions): string {
  const lines = ["[Desktop Entry]", "Type=Application", `Name=${options.name}`, `Exec=${exec_line(options.command)}`];
  if (options.comment) lines.push(`Comment=${options.comment}`);
  if (options.icon) lines.push(`Icon=${options.icon}`);
  lines.push("Terminal=false", "X-GNOME-Autostart-enabled=true");
  return `${lines.join("\n")}\n`;
}

// An entry the user turned off in their desktop's own settings, which writes Hidden=true, counts as off.
export function is_autostart_on(options: Pick<AutostartOptions, "id" | "config_dir">): boolean {
  const file = autostart_file(options);
  if (!existsSync(file)) return false;
  return !/^Hidden\s*=\s*true\s*$/im.test(readFileSync(file, "utf8"));
}

export function set_autostart(options: AutostartOptions, on: boolean): void {
  const file = autostart_file(options);
  if (!on) return rmSync(file, { force: true });
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, autostart_entry(options));
}

// The Exec value: each argument quoted when it holds a space or a character the desktop entry spec reserves, and a
// percent sign doubled, since a lone one starts a field code.
export function exec_line(command: string[]): string {
  return command
    .map((arg) => {
      const escaped = arg.replace(/%/g, "%%");
      if (escaped !== "" && !/[\s"'\\><~|&;$*?#()`]/.test(escaped)) return escaped;
      return `"${escaped.replace(/["`$\\]/g, (char) => `\\${char}`)}"`;
    })
    .join(" ");
}

// ── Launch command ───────────────────────────────────────────────────────────

export interface LaunchOptions {
  // The program that starts this app, such as the name a Nix wrapper puts on the PATH; worked out below unless set.
  launcher?: string | null;
  // Electron's app.isPackaged.
  is_packaged: boolean;
  // Electron's app.getAppPath(), which an unpackaged run passes to Electron.
  app_path: string;
  args?: string[];
}

// The command that starts this same app again: through Flatpak inside a Flatpak, the AppImage's own file inside an
// AppImage, the packaged binary, or Electron with the app's folder.
export function launch_command({ launcher = null, is_packaged, app_path, args = [] }: LaunchOptions): string[] {
  if (launcher) return [launcher, ...args];
  if (process.env.FLATPAK_ID) return ["flatpak", "run", process.env.FLATPAK_ID, ...args];
  if (process.env.APPIMAGE) return [process.env.APPIMAGE, ...args];
  if (is_packaged) return [process.execPath, ...args];
  return [process.execPath, app_path, ...args];
}
