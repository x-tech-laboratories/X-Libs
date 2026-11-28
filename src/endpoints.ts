// An API endpoint a user points an app at, such as a model server's: whether it answers on the user's own machine or
// network, and its failures put in plain words that say what happened and what to do, with the raw detail kept for a
// Details disclosure. No message names a key, and the endpoint is named by host and port alone.

// ── Hosting ──────────────────────────────────────────────────────────────────

// The four numbers of an IPv4 address, or null for anything else.
function ipv4_parts(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  return numbers.every((number) => number <= 255) ? numbers : null;
}

// Loopback (127/8), private (10/8, 172.16/12, 192.168/16) or link-local (169.254/16).
function is_local_ipv4([first, second]: number[]): boolean {
  return first === 127 || first === 10 || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}

// Loopback (::1), unique local (fc00::/7), link-local (fe80::/10) or an IPv4 address mapped into IPv6.
function is_local_ipv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  if (mapped) {
    const parts = ipv4_parts(mapped[1]!);
    return parts !== null && is_local_ipv4(parts);
  }
  // The same, as URL writes it: two groups of hex, such as ::ffff:c0a8:102 for 192.168.1.2.
  const mapped_hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  if (mapped_hex) {
    const [high, low] = [parseInt(mapped_hex[1]!, 16), parseInt(mapped_hex[2]!, 16)];
    return is_local_ipv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  return /^f[cd][0-9a-f]{0,2}:/.test(bare) || /^fe[89ab][0-9a-f]?:/.test(bare);
}

// Whether the endpoint's host is loopback or a private-network address; an empty or unreadable endpoint is not.
export function is_local_endpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const parts = ipv4_parts(host);
  if (parts) return is_local_ipv4(parts);
  return host.includes(":") && is_local_ipv6(host);
}

// The endpoint's host and port, never its path, user or password; the default endpoint when it is empty.
export function host_of(endpoint: string, default_endpoint = ""): string {
  try {
    const url = new URL(endpoint.trim() || default_endpoint);
    const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
    return port ? `${url.hostname}:${port}` : url.hostname;
  } catch {
    return "the address in its settings";
  }
}

// ── Plain failures ───────────────────────────────────────────────────────────

// A failure put in plain words, with the raw detail behind it.
export interface PlainError {
  message: string;
  detail?: string;
}

export class PlainFailure extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "PlainFailure";
    this.detail = detail;
  }
}

// A request the endpoint refused as larger than its model's context, with the tokens it counted when it said.
export class ContextOverflow extends Error {
  readonly prompt_tokens: number | null;

  constructor(message: string, prompt_tokens: number | null = null) {
    super(message);
    this.name = "ContextOverflow";
    this.prompt_tokens = prompt_tokens;
  }
}

// Anything shaped like an API key, which some providers quote back in part, is hidden.
export function hide_keys(text: string): string {
  return text.replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9*_.-]{5,}[A-Za-z0-9*_-]/gi, "[hidden]");
}

function status_of(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codes_of(error: unknown): string[] {
  const codes: string[] = [];
  for (let at: unknown = error, depth = 0; at && typeof at === "object" && depth < 5; at = (at as { cause?: unknown }).cause, depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
  }
  return codes;
}

const overflow_words = /context (?:length|size|window)|exceeds the available context|prompt is too long|too many tokens|maximum context|context_length_exceeded|input is too long/i;

// The endpoint refused a request as larger than its context, with the size it counted when it said; null for another failure.
export function overflow_of(error: unknown): ContextOverflow | null {
  if (error instanceof ContextOverflow) return error;
  const status = status_of(error);
  const message = message_of(error);
  if (status !== 413 && !(status === 400 && overflow_words.test(message))) return null;
  const counted = /request \((\d+) tokens\)|resulted in (\d+) tokens|too long: (\d+) tokens|prompt has (\d+) tokens/i.exec(message);
  const tokens = counted ? Number(counted.slice(1).find(Boolean)) : null;
  return new ContextOverflow(hide_keys(message), tokens);
}

// ── Explaining ───────────────────────────────────────────────────────────────

export interface EndpointWhere {
  // The endpoint set, empty for the provider's own.
  endpoint: string;
  // The provider's own address, used when the endpoint is empty.
  default_endpoint?: string;
  model?: string;
  // What answers there, such as "engine" or "embedder"; "service" unless given.
  label?: string;
  // Where its settings are, such as "Settings → Index", named in the advice.
  settings?: string;
  // What its key is called in the advice, such as "API key command"; "API key" unless given.
  key_name?: string;
  // What the endpoint should serve, such as "chat completions"; "API" unless given.
  serves?: string;
  // What the user does once the server answers again, such as "send again", said after a timeout.
  retry?: string;
  // Said after a rate limit, such as "Indexing tries again later."; "Wait a minute and try again." unless given.
  rate_limit_advice?: string;
  // Said after a request too large for the model, such as how to raise its context size.
  overflow_advice?: string;
  // Keeps the raw message of a failure that never reached the endpoint and is none of the above, such as a check of the
  // app's own; such a failure is otherwise said to be one the endpoint could not answer.
  keep_unknown?: boolean;
}

const connection_codes = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

// The SDKs' error classes keep the name "Error", so their class is told by its constructor too.
function is_named(error: unknown, name: string): boolean {
  const given = error as { name?: unknown; constructor?: { name?: unknown } } | null;
  return given?.name === name || given?.constructor?.name === name;
}

function is_timeout(error: unknown): boolean {
  return is_named(error, "APIConnectionTimeoutError") || codes_of(error).includes("ETIMEDOUT") || /^Request timed out\.?$/i.test(message_of(error));
}

function is_unreachable(error: unknown): boolean {
  return is_named(error, "APIConnectionError") || codes_of(error).some((code) => connection_codes.has(code)) || /^(Connection error\.|fetch failed)$/i.test(message_of(error));
}

// A failure reaching or asking the endpoint in plain words, with the raw text, its keys hidden, as its detail.
export function explain_endpoint_failure(error: unknown, where: EndpointWhere): PlainError {
  const at = `The ${where.label ?? "service"} at ${host_of(where.endpoint, where.default_endpoint)}`;
  const under = where.settings ? ` under ${where.settings}` : "";
  const status = status_of(error);
  const raw = hide_keys(message_of(error));
  const codes = codes_of(error).filter((code) => !raw.includes(code));
  const detail = codes.length > 0 ? `${raw} (${codes.join(", ")})` : raw;
  const plain = (message: string): PlainError => ({ message, detail });
  if (is_timeout(error)) return plain(`${at} did not answer in time. Check that its server is running and not overloaded${where.retry ? `, then ${where.retry}` : ""}.`);
  if (status === null && is_unreachable(error)) return plain(`${at} cannot be reached. Check that its server is running and that its endpoint${under} is right.`);
  if (overflow_of(error)) return plain(`The request was too large for the model's context.${where.overflow_advice ? ` ${where.overflow_advice}` : ""}`);
  if (status === 401 || status === 403) return plain(`${at} refused the API key. Check its ${where.key_name ?? "API key"}${under}.`);
  if (status === 404 && /model/i.test(raw)) return plain(`${at} does not know the model “${where.model ?? ""}”. Check the model's name${under}.`);
  if (status === 404) return plain(`${at} has no ${where.serves ?? "API"} at that address. Check its endpoint${under}; it usually ends in /v1.`);
  if (status === 429) return plain(`${at} is limiting how often it is asked. ${where.rate_limit_advice ?? "Wait a minute and try again."}`);
  if (status === null && where.keep_unknown) return { message: raw };
  return plain(`${at} could not answer.`);
}
