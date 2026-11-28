// Which web addresses a server may fetch for its user or a program: plain http or https, no credentials in the
// address, the usual port unless the app allows another, and a host that resolves only to public addresses, checked
// again as the connection is made, so a name that changes its answer cannot lead to this computer or its network.

// ── Imports ──────────────────────────────────────────────────────────────────

import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";

// ── Public addresses ─────────────────────────────────────────────────────────

const non_public_ipv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  non_public_ipv4.addSubnet(network, prefix, "ipv4");
}

const non_public_ipv6 = new BlockList();
for (const [network, prefix] of [
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  non_public_ipv6.addSubnet(network, prefix, "ipv6");
}

// An IPv6 address as its sixteen bytes, or null when it is not one.
function ipv6_bytes(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address.split("%")[0]!.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const quad = dotted[1]!.split(".").map(Number);
    text = `${text.slice(0, dotted.index)}${((quad[0]! << 8) | quad[1]!).toString(16)}:${((quad[2]! << 8) | quad[3]!).toString(16)}`;
  }
  const [head, tail] = text.split("::") as [string, string | undefined];
  const groups_of = (part: string | undefined) => (part ? part.split(":").filter(Boolean) : []);
  const front = groups_of(head);
  const back = groups_of(tail);
  const groups = tail === undefined ? front : [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back];
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 255];
  });
}

// Whether an address is reachable on the public internet; an IPv4 address carried inside IPv6, mapped or through the
// NAT64 prefix, is judged as itself.
export function is_public_address(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !non_public_ipv4.check(address, "ipv4");
  const bytes = ipv6_bytes(address);
  if (!bytes) return false;
  const embedded = bytes.slice(12).join(".");
  const zero_until = (end: number) => bytes.slice(0, end).every((byte) => byte === 0);
  // ::ffff:a.b.c.d, mapped.
  if (zero_until(10) && bytes[10] === 255 && bytes[11] === 255) return is_public_address(embedded);
  // ::a.b.c.d and every address under ::/96, :: and ::1 among them.
  if (zero_until(12)) return false;
  // 64:ff9b::a.b.c.d, the NAT64 prefix.
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) return is_public_address(embedded);
  return !non_public_ipv6.check(address.split("%")[0]!, "ipv6");
}

// ── Guard ────────────────────────────────────────────────────────────────────

export type Resolver = (hostname: string) => Promise<string[]>;

export interface GuardOptions {
  // Finds a host's addresses; the system's resolver unless a test gives another.
  resolve?: Resolver;
  // Ports other than 80 for http and 443 for https that the app allows.
  allowed_ports?: ReadonlySet<number>;
  // Said after a refused port, such as "unless the user lists others in Settings → Web".
  ports_hint?: string;
  // Tests alone: addresses let through though not public, such as a fake server's on loopback.
  allow_address?: (address: string) => boolean;
}

async function system_resolver(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((found) => found.address);
}

// The ports a setting such as "8080, 8443" lists; anything else in it is left out.
export function ports_of(setting: unknown): Set<number> {
  return new Set(
    String(setting ?? "")
      .split(/[\s,;]+/)
      .map(Number)
      .filter((port) => Number.isInteger(port) && port > 0 && port < 65536),
  );
}

// The address as a URL when its form may be fetched: http or https, no name or password, and its port the usual one
// or one the app allows, without its #fragment. Throws a plain error saying why not.
export function checked_web_address(url: string, options: GuardOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    throw new Error("Give a whole web address, starting with http:// or https://.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Only http and https addresses can be read, not ${parsed.protocol.replace(/:$/, "")}.`);
  if (!parsed.hostname) throw new Error("Give a whole web address, with its host.");
  if (parsed.username || parsed.password) throw new Error("An address with a name or password in it is not read.");
  if (parsed.port && !options.allowed_ports?.has(Number(parsed.port))) throw new Error(`Port ${parsed.port} is not allowed; only 80 and 443 are${options.ports_hint ? `, ${options.ports_hint}` : ""}.`);
  parsed.hash = "";
  return parsed;
}

// The host's addresses, when every one of them is public (or a test lets it through); throws a plain error otherwise.
export async function public_addresses(hostname: string, options: GuardOptions = {}): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host) throw new Error("Give a whole web address, with its host.");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (options.resolve ?? system_resolver)(host);
  } catch {
    throw new Error(`The host ${host} could not be found.`);
  }
  if (addresses.length === 0) throw new Error(`The host ${host} could not be found.`);
  const refused = addresses.find((address) => !is_public_address(address) && options.allow_address?.(address) !== true);
  if (refused !== undefined) throw new Error(`${host} is not a public address (it leads to ${refused}), so it is not read: only pages on the public web are.`);
  return addresses;
}

// The lookup a connection is made with, as node:http's `lookup` option, so it reaches only the addresses just checked,
// however the name answers.
export function guarded_lookup(options: GuardOptions = {}): LookupFunction {
  const guarded = (hostname: string, given: { all?: boolean } | number | undefined, callback: (...args: unknown[]) => void) => {
    public_addresses(hostname, options).then(
      (addresses) => {
        if (typeof given === "object" && given?.all) callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
        else callback(null, addresses[0], isIP(addresses[0]!));
      },
      (error: Error) => callback(error),
    );
  };
  return guarded as unknown as LookupFunction;
}
