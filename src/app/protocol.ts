// What the base app's hosts and processes say to each other: the page's api on every host, and the desktop app's own
// settings, which its daemon keeps beside the database rather than syncing, since they belong to the computer.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { BackupClient } from "../backups.ts";
import type { CertificateClient } from "../certificate_protocol.ts";
import type { ConnectionClient } from "../connection_protocol.ts";
import type { Client } from "../electron/bridge.ts";
import type { PeerListeningClient, SyncDeviceClient } from "../sync_protocol.ts";

// ── Desktop settings ─────────────────────────────────────────────────────────

export interface DesktopSettings {
  keep_running_in_background: boolean;
  start_at_login: boolean;
}

export const desktop_setting_defaults: DesktopSettings = {
  keep_running_in_background: true,
  start_at_login: true,
};

// Settings saved on the device, each default where it is missing or damaged.
export function read_desktop_settings(saved: unknown): DesktopSettings {
  const settings = (saved ?? {}) as Partial<Record<keyof DesktopSettings, unknown>>;
  const flag = (key: keyof DesktopSettings): boolean => (typeof settings[key] === "boolean" ? settings[key] : desktop_setting_defaults[key]);
  return { keep_running_in_background: flag("keep_running_in_background"), start_at_login: flag("start_at_login") };
}

// What the page asks of the desktop app; quitting completely also stops the daemon.
export interface DesktopMethods {
  get_desktop_settings: () => DesktopSettings;
  set_desktop_setting: <Key extends keyof DesktopSettings>(key: Key, value: DesktopSettings[Key]) => void;
  quit_completely: () => void;
}

export const desktop_method_names = ["get_desktop_settings", "set_desktop_setting", "quit_completely"] as const satisfies readonly (keyof DesktopMethods)[];

// What the daemon answers about itself: its settings, and stopping.
export interface DaemonMethods {
  get_desktop_settings: () => DesktopSettings;
  set_desktop_setting: (key: keyof DesktopSettings, value: boolean) => void;
  stop_daemon: () => void;
}

// ── The page's api ───────────────────────────────────────────────────────────

export type Host = "web" | "desktop" | "android";

// The folder a phone keeps its backups in; its name is "" until one is picked.
export interface BackupFolder {
  name: () => Promise<string>;
  choose: () => Promise<string>;
}

export interface PageApi<Methods extends Record<keyof Methods, (...args: never[]) => unknown> = Record<string, (...args: never[]) => unknown>> {
  host: Host;
  calls: Client<Methods>;
  // The sync of the copy the page works on; null in a desktop window working on a server's daemon.
  device: SyncDeviceClient | null;
  // Null where backups cannot be kept yet.
  backups: BackupClient | null;
  // Set on a phone, whose backups go in a folder the user picks.
  backup_folder?: BackupFolder;
  // Set where the app makes its own connections and can trust a certificate the system refuses.
  certificates?: CertificateClient;
  // Set in the desktop app: the daemons it can work on, and its own settings.
  connections?: ConnectionClient;
  // Set on the desktop while it works on this computer's daemon, which other devices may be let reach.
  peer_listening?: PeerListeningClient;
  desktop?: Client<DesktopMethods>;
  // Runs whenever the data changed somewhere else; returns the function that stops listening.
  on_change: (listener: () => void) => () => void;
  // Runs whenever the app's services emit the named event, with its data; unset where no services run, as on a phone.
  on_event?: (event: string, listener: (data: unknown) => void) => () => void;
}
