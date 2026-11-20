// What a page and a desktop app's main process say about the app's own MCP endpoint on this computer.

// Whether the endpoint is on, and the port it listens on at 127.0.0.1.
export interface LocalMcpSettings {
  enabled: boolean;
  port: number;
  // Whether a caller must send the endpoint's token as a bearer header, so other programs on this computer cannot
  // call it; off unless set. Turning it off forgets the token, so turning it on again makes a new one.
  require_token?: boolean;
}

// Whether it is listening, where, and why it could not when it failed, such as a port already taken.
export interface LocalMcpStatus {
  state: "off" | "running" | "failed";
  url: string;
  error: string;
  // The token a caller sends while one is required, and the file it is kept in, readable by this user alone.
  token?: string;
  token_file?: string;
}

// An MCP client's entry for the endpoint, as Claude Code's .mcp.json and managed MCP config take it.
export interface LocalMcpClientEntry {
  type: "http";
  url: string;
  headers?: Record<string, string>;
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
    require_token: settings.require_token === true,
  };
}

// The client config for a running endpoint, ready to paste under "mcpServers", with the bearer header when a token is
// required; null while it is not running.
export function local_mcp_client_config(name: string, status: LocalMcpStatus): { mcpServers: Record<string, LocalMcpClientEntry> } | null {
  if (status.state !== "running") return null;
  const entry: LocalMcpClientEntry = { type: "http", url: status.url, ...(status.token ? { headers: { Authorization: `Bearer ${status.token}` } } : {}) };
  return { mcpServers: { [name]: entry } };
}

// The command that adds a running endpoint to Claude Code, reading a required token from its file so the command
// itself holds no secret; null while it is not running.
export function local_mcp_add_command(name: string, status: LocalMcpStatus): string | null {
  if (status.state !== "running") return null;
  const header = status.token_file ? ` --header "Authorization: Bearer $(cat '${status.token_file.replaceAll("'", "'\\''")}')"` : "";
  return `claude mcp add --transport http${header} ${name} ${status.url}`;
}
