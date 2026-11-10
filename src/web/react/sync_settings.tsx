// The settings rows a device shows for syncing with its server: the status, and either the server it follows or the
// form to connect one, choosing which copy wins the first time.

import { useEffect, useState } from "react";
import type { SyncDeviceClient, SyncDirection, SyncStatus } from "../../sync_protocol.ts";
import { describe_error } from "../errors.ts";
import { StatusPill } from "./badges.tsx";
import { SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

const sync_tones = { off: "none", idle: "good", syncing: "info", offline: "warn", needs_setup: "warn", failed: "bad" } as const;

export interface SyncSettingsProps {
  device: SyncDeviceClient;
  // Rereads the status whenever it fires, such as on the device's sync_status or changed events.
  subscribe?: (listener: () => void) => () => void;
  // An example address for the server field, such as "https://tasks.example.org/".
  placeholder?: string;
}

export function SyncSettings({ device, subscribe, placeholder }: SyncSettingsProps) {
  const [status, set_status] = useState<SyncStatus | null>(null);
  const [server_url, set_server_url] = useState("");
  const [token, set_token] = useState("");

  useEffect(() => {
    const read = () => void device.get_sync_status().then(set_status);
    read();
    return subscribe?.(read);
  }, [device, subscribe]);

  async function connect(direction: SyncDirection): Promise<void> {
    try {
      set_status(await device.connect_sync(server_url || status?.server_url || "", token, direction));
      set_token("");
      toast(direction === "download" ? "This device now has the server's data" : "The server now has this device's data", { tone: "good" });
    } catch (error) {
      toast(describe_error(error), { tone: "bad" });
    }
  }

  if (!status) return null;
  const is_connected = status.state !== "off" && status.state !== "needs_setup";
  return (
    <>
      <SettingRow label="Status">
        <StatusPill tone={sync_tones[status.state]} busy={status.state === "syncing"} label={status.state === "off" ? "Not syncing" : `${status.state}${status.error ? `: ${status.error}` : ""}`} />
      </SettingRow>
      {is_connected ? (
        <SettingRow label={status.server_url} hint={`${status.pending_changes} changes waiting · last synced ${status.last_synced_at || "never"}`}>
          <button type="button" onClick={() => void device.sync_now().then(set_status)}>Sync now</button>
          <button type="button" onClick={() => void device.disconnect_sync().then(set_status)}>Stop syncing</button>
        </SettingRow>
      ) : (
        <>
          <SettingRow label="Server address" as_label>
            <input type="url" placeholder={placeholder} defaultValue={status.server_url} onChange={(event) => set_server_url(event.currentTarget.value)} />
          </SettingRow>
          <SettingRow label="Access token" as_label>
            <input type="password" autoComplete="off" value={token} onChange={(event) => set_token(event.currentTarget.value)} />
          </SettingRow>
          <SettingRow label="First sync" hint="Which copy wins the first time; the other is backed up before it is replaced.">
            <button type="button" onClick={() => void connect("download")}>Use the server's data</button>
            <button type="button" onClick={() => void connect("upload")}>Use this device's data</button>
          </SettingRow>
        </>
      )}
    </>
  );
}
