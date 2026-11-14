// What a page and a desktop app's main process say about the app's own MCP endpoint on this computer.

// Whether the endpoint is on, and the port it listens on at 127.0.0.1.
export interface LocalMcpSettings {
  enabled: boolean;
  port: number;
}

// Whether it is listening, where, and why it could not when it failed, such as a port already taken.
export interface LocalMcpStatus {
  state: "off" | "running" | "failed";
  url: string;
  error: string;
}

export interface LocalMcpMethods {
  get_local_mcp_settings: () => LocalMcpSettings;
  // Stops the endpoint and starts it again on the new settings.
  set_local_mcp_settings: (settings: LocalMcpSettings) => Promise<void>;
  get_local_mcp_status: () => Promise<LocalMcpStatus>;
}

export const local_mcp_method_names = [
  "get_local_mcp_settings", "set_local_mcp_settings", "get_local_mcp_status",
] as const satisfies readonly (keyof LocalMcpMethods)[];

// The same calls as the page makes them, each answered later, as a bridge's client gives them.
export type LocalMcpClient = { [Name in keyof LocalMcpMethods]: (...args: Parameters<LocalMcpMethods[Name]>) => Promise<Awaited<ReturnType<LocalMcpMethods[Name]>>> };

// Settings read from a file or a page, with anything missing or out of range set to the defaults.
export function read_local_mcp_settings(raw: unknown, default_port: number): LocalMcpSettings {
  const settings = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof LocalMcpSettings, unknown>>;
  const port = settings.port;
  return {
    enabled: settings.enabled === true,
    port: typeof port === "number" && Number.isInteger(port) && port >= 0 && port <= 65535 ? port : default_port,
  };
}
