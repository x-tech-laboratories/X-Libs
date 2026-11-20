// The settings rows for a desktop app's own MCP endpoint: turn it on, pick its port, require a token, and see where it
// listens along with the command that adds it to Claude Code and the client config to paste.

import { useEffect, useState } from "react";
import { local_mcp_add_command, local_mcp_client_config, type LocalMcpClient, type LocalMcpSettings as Settings, type LocalMcpStatus } from "../../local_mcp_protocol.ts";
import { describe_error } from "../errors.ts";
import { ButtonGroup, NumberField, Switch } from "./controls.tsx";
import { SettingRow } from "./layout.tsx";
import { CopyButton } from "./copy_button.tsx";
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
  const [config_shown, set_config_shown] = useState(false);

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
  const command = local_mcp_add_command(name, status);
  const config = local_mcp_client_config(name, status);
  const config_text = config === null ? "" : JSON.stringify(config, null, 2);
  return (
    <>
      <SettingRow label="MCP server" hint={`Lets AI assistants on this computer ${data_name}. Only programs on this computer can reach it${settings.require_token ? ", and only with its token" : ""}.`} as_label>
        <Switch label="MCP server" checked={settings.enabled} on_change={(enabled) => void change({ ...settings, enabled })} />
      </SettingRow>
      {settings.enabled && (
        <>
          <SettingRow label="Port" hint="Change it if another program already uses this one.">
            <NumberField label="Port" bare min={1} max={65535} value={settings.port} on_change={(port) => port !== null && void change({ ...settings, port: Math.round(port) })} />
          </SettingRow>
          <SettingRow label="Require a token" hint="Callers must send the server's token, so other programs on this computer cannot use it. Turn it off and on again for a new token." as_label>
            <Switch label="Require a token" checked={settings.require_token === true} on_change={(require_token) => void change({ ...settings, require_token })} />
          </SettingRow>
          <SettingRow label="Status" hint={status_text(status)}>{null}</SettingRow>
          {command !== null && (
            <SettingRow label="Add to Claude Code" hint={<code>{command}</code>}>{null}</SettingRow>
          )}
          {config !== null && (
            <SettingRow label="Client config" hint={<>
              {status.token ? "For .mcp.json or a managed MCP config, under mcpServers. It holds the token, so keep it private." : "For .mcp.json or a managed MCP config, under mcpServers."}
              {config_shown && <pre className="output">{config_text}</pre>}
            </>}>
              <ButtonGroup label="Client config">
                <button onClick={() => set_config_shown(!config_shown)}>{config_shown ? "Hide" : "Show"}</button>
                <CopyButton text={config_text} />
              </ButtonGroup>
            </SettingRow>
          )}
        </>
      )}
    </>
  );
}
