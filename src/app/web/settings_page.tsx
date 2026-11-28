// The base app's Settings: the app's own general sections, each page's own settings, the desktop app's daemons and
// its own settings, sync on a device, and backups of a device or the server.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

import type { BackupClient } from "../../backups.ts";
import { BackupSettings } from "../../web/react/backup_settings.tsx";
import { TrustedCertificates } from "../../web/react/certificates.tsx";
import { ConnectionSettings } from "../../web/react/connections.tsx";
import { Switch } from "../../web/react/controls.tsx";
import type { IconGlyph } from "../../web/react/icons.tsx";
import { PageHeading, SettingRow, SettingsPage, type SettingsCategory, type SettingsSection } from "../../web/react/layout.tsx";
import type { ShellSidePane } from "../../web/react/shell.tsx";
import { Loaded } from "../../web/react/states.tsx";
import { PeerListeningSettings, SyncSettings } from "../../web/react/sync_settings.tsx";
import { attempt } from "../../web/react/toasts.tsx";
import type { App } from "../define.ts";
import type { BackupFolder, DesktopSettingSpec, DesktopSettings } from "../protocol.ts";
import { calls, data_watch, page, use_settings } from "./page.ts";

// ── Pages ────────────────────────────────────────────────────────────────────

export interface PageSettingsProps {
  settings: Record<string, unknown>;
  set_setting: (key: string, value: unknown) => Promise<void>;
}

// One section of the app: a sidebar entry, its view and its settings.
export interface AppPage {
  // The route's first part, such as "plan" for #/plan.
  id: string;
  label: string;
  view: (parts: string[]) => React.ReactNode;
  settings?: (props: PageSettingsProps) => SettingsSection[];
  // Its sidebar row's icon; once any page has one, the sidebar shows every row with its icon.
  icon?: IconGlyph;
  // A hook giving what the row shows beside its label, such as how many things wait; nothing while null or 0.
  use_badge?: () => number | string | null;
  // False for a page reached only by its route, such as one item's page, which lights up `active_as` instead.
  in_sidebar?: boolean;
  active_as?: string;
}

// What the app shows around its pages, worked out by a hook from the route: content under the sidebar's rows, such as
// a tree of items, tools in the header, and a pane beside the page, such as an assistant.
export interface AppChrome {
  sidebar?: React.ReactNode;
  tools?: React.ReactNode;
  side_pane?: ShellSidePane;
}

// What the page side of the base app is given: the app, its pages, and its own sections under General.
export interface AppPages {
  app: Pick<App, "id" | "name" | "data_name" | "server_example" | "bridges"> & Partial<Pick<App, "desktop_settings">>;
  pages: readonly AppPage[];
  general_settings?: (props: PageSettingsProps) => SettingsSection[];
  // The icon the sidebar and sign-in show, an image URL beside the page; "icon.svg" unless set.
  brand_icon?: string;
  // The page an empty route opens; the first page unless set.
  default_page?: string;
  // A hook, called on every render with the route's parts, for what the app shows around its pages.
  use_chrome?: (parts: readonly string[]) => AppChrome;
}

// ── Sections ─────────────────────────────────────────────────────────────────

// A phone's backups go in a folder picked once in its storage, where file managers and sync apps reach them.
function FolderBackups({ backups, folder, data_name }: { backups: BackupClient; folder: BackupFolder; data_name: string }) {
  const [name, set_name] = useState<string | null>(null);
  useEffect(() => void folder.name().then(set_name), [folder]);

  const folder_row = (
    <SettingRow label="Backup folder" hint={name ? undefined : "Pick a folder in the phone's storage; backups start once one is picked."}>
      {name && <span>{name}</span>}
      <button type="button" onClick={() => attempt(folder.choose().then(set_name))}>{name ? "Change folder…" : "Choose folder…"}</button>
    </SettingRow>
  );
  // Drawn afresh for a new folder, so its backups are listed.
  return <BackupSettings key={name ?? ""} device={backups} data_name={data_name} on_restored={() => location.reload()} folder_row={folder_row} can_back_up={Boolean(name)} />;
}

// The desktop app's own settings, which belong to this computer and do not sync.
function Desktop({ app_name, own }: { app_name: string; own: Readonly<Record<string, DesktopSettingSpec>> }) {
  const { desktop } = page();
  const [settings, set_settings] = useState<DesktopSettings | null>(null);
  useEffect(() => void desktop?.get_desktop_settings().then(set_settings, () => undefined), [desktop]);
  if (!desktop || !settings) return null;

  const change = (key: keyof DesktopSettings, on: boolean): void => {
    set_settings({ ...settings, [key]: on });
    attempt(desktop.set_desktop_setting(key, on));
  };
  return (
    <>
      <SettingRow label="Show the tray icon" hint={`Keeps ${app_name} in the tray, where closing the window leaves it.`} as_label>
        <Switch label="Show the tray icon" checked={settings.show_tray_icon} on_change={(on) => change("show_tray_icon", on)} />
      </SettingRow>
      <SettingRow label="Keep running in the background" hint="Sync and backups carry on with the window closed. Turned off, they stop shortly after the last window closes." as_label>
        <Switch label="Keep running in the background" checked={settings.keep_running_in_background} on_change={(on) => change("keep_running_in_background", on)} />
      </SettingRow>
      <SettingRow label="Start at login" hint={`Starts ${app_name} in the background when you log in, without opening its window.`} as_label>
        <Switch label="Start at login" checked={settings.start_at_login} disabled={!settings.keep_running_in_background} on_change={(on) => change("start_at_login", on)} />
      </SettingRow>
      {Object.entries(own).map(([key, spec]) => (
        <SettingRow key={key} label={spec.label} {...(spec.hint ? { hint: spec.hint } : {})} as_label>
          <Switch label={spec.label} checked={settings[key] ?? spec.default} on_change={(on) => change(key, on)} />
        </SettingRow>
      ))}
      <SettingRow label="Quit completely" hint={`Closes the window and stops ${app_name} in the background too, until you open it again.`}>
        <button type="button" onClick={() => attempt(desktop.quit_completely())}>Quit completely</button>
      </SettingRow>
    </>
  );
}

// A desktop window on a server's daemon works on the server's data, as a browser does.
function storage_category(app: AppPages["app"], is_admin: boolean): SettingsCategory[] {
  const { backups, backup_folder, certificates, connections, desktop, device, host, peer_listening } = page();
  const { data_name, name } = app;
  const on_server = host === "web" || (host === "desktop" && !device);
  const sections: SettingsSection[] = [];
  if (connections) {
    sections.push({ id: "connections", heading: "Connections", hint: `The ${data_name} this window works on: This computer's own, or an ${name} server's.`, content: <>
      <ConnectionSettings client={connections} certificates={certificates} placeholder={app.server_example} />
      {!device && certificates && <TrustedCertificates certificates={certificates} />}
    </> });
  }
  if (desktop) sections.push({ id: "desktop", heading: "Desktop app", content: <Desktop app_name={name} own={app.desktop_settings ?? {}} /> });
  if (device && (!on_server || is_admin)) {
    const hint = on_server ? `Keep the server's ${data_name} alike with the devices paired with it.` : `Keep this device's ${data_name} alike with your other devices and your ${name} server.`;
    sections.push({ id: "sync", heading: "Sync", hint, content: <SyncSettings device={device} subscribe={(listener) => data_watch.subscribe(listener)} data_name={data_name} extra={peer_listening && <PeerListeningSettings listening={peer_listening} />} /> });
  }
  if (backups && (!on_server || is_admin)) {
    const hint = backup_folder ? `This device's ${data_name}, kept in a folder of the phone's storage.` : on_server ? `The server's ${data_name}, kept in its data folder.` : `This device's ${data_name}, kept beside its database.`;
    const content = backup_folder ? <FolderBackups backups={backups} folder={backup_folder} data_name={data_name} /> : <BackupSettings device={backups} data_name={data_name} on_restored={() => location.reload()} />;
    sections.push({ id: "backups", heading: "Backups", hint, content });
  }
  return sections.length === 0 ? [] : [{ heading: host === "web" ? "Server" : "This device", sections }];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SettingsView({ pages, is_admin = true }: { pages: AppPages; is_admin?: boolean }) {
  const settings = use_settings();
  const set_setting = async (key: string, value: unknown): Promise<void> => void (await calls().set_setting!(key as never, value as never));

  return (
    <>
      <PageHeading title="Settings" />
      <Loaded resource={settings}>
        {(values) => {
          const props = { settings: values, set_setting };
          const general = pages.general_settings?.(props) ?? [];
          return (
            <SettingsPage
              categories={[
                ...(general.length > 0 ? [{ heading: "General", sections: general }] : []),
                ...pages.pages
                  .map((each) => ({ heading: each.label, sections: each.settings?.(props) ?? [] }))
                  .filter((category) => category.sections.length > 0),
                ...storage_category(pages.app, is_admin),
              ]}
            />
          );
        }}
      </Loaded>
    </>
  );
}
