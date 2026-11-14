// The settings rows for a desktop app's own MCP endpoint: turn it on, pick its port, and see where it listens along
// with the command that adds it to Claude Code.

import { useEffect, useState } from "react";
import type { LocalMcpClient, LocalMcpSettings as Settings, LocalMcpStatus } from "../../local_mcp_protocol.ts";
import { describe_error } from "../errors.ts";
import { NumberField, Switch } from "./controls.tsx";
import { SettingRow } from "./layout.tsx";
import { toast } from "./toasts.tsx";

export interface LocalMcpSettingsProps {
  device: LocalMcpClient;
  // The name the endpoint is added under, such as "x-fitness".
  name: string;
  // What AI clients may do through it, such as "read and change workouts, food and body readings".
  data_name?: string;
}

function status_text(status: LocalMcpStatus): string {
  if (status.state === "running") return `Listening on ${status.url}`;
  if (status.state === "failed") return `Could not start: ${status.error}`;
  return "Off";
}

export function LocalMcpSettings({ device, name, data_name = "read and change this app's data" }: LocalMcpSettingsProps) {
  const [settings, set_settings] = useState<Settings | null>(null);
  const [status, set_status] = useState<LocalMcpStatus | null>(null);

  async function refresh(): Promise<void> {
    set_settings(await device.get_local_mcp_settings());
    set_status(await device.get_local_mcp_status());
  }

  useEffect(() => {
    void refresh();
  }, [device]);

  async function change(next: Settings): Promise<void> {
    set_settings(next);
    try {
      await device.set_local_mcp_settings(next);
    } catch (error) {
      toast(describe_error(error), { tone: "bad" });
    }
    await refresh();
  }

  if (!settings || !status) return null;
  return (
    <>
      <SettingRow label="MCP server" hint={`Lets AI assistants on this computer ${data_name}. Only programs on this computer can reach it.`} as_label>
        <Switch label="MCP server" checked={settings.enabled} on_change={(enabled) => void change({ ...settings, enabled })} />
      </SettingRow>
      {settings.enabled && (
        <>
          <SettingRow label="Port" hint="Change it if another program already uses this one.">
            <NumberField label="Port" bare min={1} max={65535} value={settings.port} on_change={(port) => port !== null && void change({ ...settings, port: Math.round(port) })} />
          </SettingRow>
          <SettingRow label="Status" hint={status_text(status)}>{null}</SettingRow>
          {status.state === "running" && (
            <SettingRow label="Add to Claude Code" hint={<code>{`claude mcp add --transport http ${name} ${status.url}`}</code>}>{null}</SettingRow>
          )}
        </>
      )}
    </>
  );
}
