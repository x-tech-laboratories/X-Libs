// The Sync section every app with a sync server shows in its settings: the status, and either who the device is signed
// in as with Sync now and Stop syncing, or the server's address, a name and password (and the code when asked) and the
// choice of which copy wins the first time, asked before it replaces anything. It pairs with sync_client, which runs wherever the app keeps its database.

import { useEffect, useState, type FormEvent } from "react";
import { asks_for_code, type SyncDeviceClient, type SyncDirection, type SyncStatus } from "../../sync_protocol.ts";
import { describe_error } from "../errors.ts";
import { StatusPill } from "./badges.tsx";
import { confirm_dialog } from "./dialog.tsx";
import { SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

export interface SyncSettingsProps {
  // The device's side as the page reaches it, such as through Electron's preload or a phone's bridge.
  device: SyncDeviceClient;
  // Reads the status again whenever it calls back, such as after a sync changed the data; returns how to stop.
  subscribe?: (listener: () => void) => () => void;
  // What the data is called, such as "tasks"; "data" unless set.
  data_name?: string;
  // An example server address.
  placeholder?: string;
  // What the question before each choice says; the standard words unless set.
  confirm_text?: Record<SyncDirection, string>;
}

const tones = { off: "none", idle: "good", syncing: "info", offline: "warn", needs_setup: "warn", failed: "bad" } as const;
const state_text = { off: "Not syncing", idle: "Synced", syncing: "Syncing", offline: "Offline", needs_setup: "Needs a choice", failed: "Failed" } as const;

export function SyncSettings({ device, subscribe, data_name, placeholder = "https://sync.example.org/", confirm_text }: SyncSettingsProps) {
  const [status, set_status] = useState<SyncStatus | null>(null);
  const [server_url, set_server_url] = useState("");
  const [name, set_name] = useState("");
  const [password, set_password] = useState("");
  const [code, set_code] = useState("");
  const [asks_code, set_asks_code] = useState(false);
  const [busy, set_busy] = useState(false);

  useEffect(() => {
    const read = () => void device.get_sync_status().then(set_status);
    read();
    return subscribe?.(read);
  }, [device, subscribe]);

  // A device that only has to choose a direction again keeps its sign-in.
  const keeps_sign_in = status?.state === "needs_setup" && status.user !== "";

  async function connect(direction: SyncDirection): Promise<void> {
    set_busy(true);
    try {
      const credentials = keeps_sign_in ? null : { name, password, ...(asks_code ? { code } : {}) };
      set_status(await device.connect_sync(server_url || status?.server_url || "", credentials, direction));
      set_password("");
      set_code("");
      set_asks_code(false);
      toast(direction === "download" ? `This device now has the server's ${data_name}.` : `The server now has this device's ${data_name}.`, { tone: "good" });
    } catch (error) {
      if (asks_for_code(error) && !asks_code) set_asks_code(true);
      else toast(describe_error(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { tone: "bad" });
    } finally {
      set_busy(false);
    }
  }

  // Asks before one copy replaces the other, but not again when only the code was missing.
  function choose(direction: SyncDirection): void {
    if (asks_code) return void connect(direction);
    const question = confirm_text?.[direction] ?? (direction === "download"
      ? `Replace the ${data_name} on this device with the server's? A copy of this device's is kept first.`
      : `Replace the ${data_name} on the server with this device's? Other devices will have to choose again, and the server keeps a copy first.`);
    confirm_dialog({
      title: direction === "download" ? `Use the server's ${data_name}?` : `Use this device's ${data_name}?`,
      message: question,
      confirm_label: direction === "download" ? "Use the server's" : "Use this device's",
      danger: true,
      run: () => connect(direction),
    });
  }

  if (!status) return null;
  const label = `${state_text[status.state]}${status.error ? `: ${status.error}` : ""}`;
  const connected = status.state !== "off" && status.state !== "needs_setup";

  return (
    <>
      <SettingRow label="Status">
        <StatusPill tone={tones[status.state]} busy={status.state === "syncing"} label={label} />
      </SettingRow>
      {connected ? (
        <SettingRow label={status.user ? `Signed in as ${status.user}` : status.server_url} hint={`${status.server_url} · ${status.pending_changes} changes waiting · last synced ${status.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : "never"}`}>
          <button type="button" onClick={() => void device.sync_now().then(set_status)}>Sync now</button>
          <button type="button" onClick={() => void device.disconnect_sync().then(set_status)}>Stop syncing</button>
        </SettingRow>
      ) : (
        <form onSubmit={(event: FormEvent) => event.preventDefault()}>
          <SettingRow label="Server address" as_label>
            <input type="url" placeholder={placeholder} defaultValue={status.server_url} onChange={(event) => set_server_url(event.currentTarget.value)} />
          </SettingRow>
          {keeps_sign_in ? (
            <SettingRow label="Signed in as">{status.user}</SettingRow>
          ) : <>
            <SettingRow label="User name" as_label>
              <input type="text" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={name} onChange={(event) => set_name(event.currentTarget.value)} />
            </SettingRow>
            <SettingRow label="Password" as_label>
              <input type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => set_password(event.currentTarget.value)} />
            </SettingRow>
            {asks_code && (
              <SettingRow label="Code from your authenticator app, or a recovery code" as_label>
                <input type="text" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" autoFocus value={code} onChange={(event) => set_code(event.currentTarget.value)} />
              </SettingRow>
            )}
          </>}
          <SettingRow label="First sync" hint="Which copy wins the first time; the other is backed up before it is replaced.">
            <button type="button" disabled={busy} onClick={() => choose("download")}>{`Use the server's ${data_name}`}</button>
            <button type="button" disabled={busy} onClick={() => choose("upload")}>{`Use this device's ${data_name}`}</button>
          </SettingRow>
        </form>
      )}
    </>
  );
}
