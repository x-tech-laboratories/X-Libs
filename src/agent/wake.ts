// Wake-on-LAN: the magic packet that wakes a sleeping machine, with a SecureOn password when the card asks for one, sent
// by a server or by an agent on that machine's network, or by a shell command run on a host that reaches it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createSocket } from "node:dgram";

// ── Shapes ───────────────────────────────────────────────────────────────────

// Where a packet goes: the MAC address of the card that wakes the machine, the address it is sent to, and the port.
export interface WakeTarget {
  mac: string;
  broadcast: string;
  port: number;
  // The card's SecureOn password, six bytes written like a MAC address or four like an IPv4 address.
  password?: string | null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

// How many copies of the packet go out, as a single one may be dropped.
const copies = 3;

export const default_broadcast = "255.255.255.255";
export const default_port = 9;

// Sends the hex bytes in argv[1] to argv[2]:argv[3] as one broadcast UDP datagram.
const python_sender =
  "import socket,sys;" +
  "s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);" +
  "s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1);" +
  "s.sendto(bytes.fromhex(sys.argv[1]),(sys.argv[2],int(sys.argv[3])))";

// ── Packet ───────────────────────────────────────────────────────────────────

// A MAC address's six bytes, written with colons, dashes, dots or no separators at all.
export function parse_mac(mac: unknown): Buffer {
  const digits = String(mac ?? "").replace(/[:\-.\s]/g, "");
  if (!/^[0-9A-Fa-f]{12}$/.test(digits)) throw new Error(`'${String(mac ?? "")}' is not a MAC address`);
  return Buffer.from(digits, "hex");
}

// A SecureOn password's bytes: six written like a MAC address, or four written like an IPv4 address.
export function parse_password(password: unknown): Buffer {
  const text = String(password).trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split(".").map(Number);
    if (parts.every((part) => part <= 255)) return Buffer.from(parts);
  }
  try {
    return parse_mac(text);
  } catch {
    throw new Error(`'${String(password)}' is not a SecureOn password (six hex bytes or a dotted quad)`);
  }
}

// Six 0xff bytes, then the MAC address sixteen times, then the SecureOn password when there is one.
export function magic_packet(mac: unknown, password: string | null = null): Buffer {
  const address = parse_mac(mac);
  const parts = [Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => address)];
  if (password) parts.push(parse_password(password));
  return Buffer.concat(parts);
}

// ── Sending ──────────────────────────────────────────────────────────────────

// Sends a ready packet as UDP datagrams from this machine, once unless `times` says more, rejecting when the network refuses.
export async function send_wake_packet(packet: Buffer, address = default_broadcast, port = default_port, times = 1): Promise<void> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(() => resolve());
    });
    socket.setBroadcast(true);
    for (let sent = 0; sent < times; sent++) {
      await new Promise<void>((resolve, reject) => socket.send(packet, Math.trunc(port), address, (error) => (error ? reject(error) : resolve())));
    }
  } finally {
    socket.close();
  }
}

// Sends a few copies of the target's packet.
export async function send_magic_packet(target: WakeTarget): Promise<void> {
  await send_wake_packet(magic_packet(target.mac, target.password ?? null), target.broadcast, target.port, copies);
}

// A shell command that sends the packet from whichever host runs it, with python3 or else socat, failing with 127 and
// `missing_message` when it has neither.
export function remote_send_command(packet: Buffer, address = default_broadcast, port = default_port, missing_message = "sending a wake packet needs python3 or socat on this host"): string {
  const target = shell_word(address);
  const port_number = Math.trunc(port);
  const octal = [...packet].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");
  return (
    "if command -v python3 >/dev/null 2>&1; then " +
    `python3 -c ${shell_word(python_sender)} ${packet.toString("hex")} ${target} ${port_number}; ` +
    "elif command -v socat >/dev/null 2>&1; then " +
    `printf '${octal}' | socat -u - UDP-DATAGRAM:${target}:${port_number},broadcast; ` +
    `else echo ${shell_word(missing_message)} >&2; ` +
    "exit 127; fi"
  );
}

// A word the shell reads back unchanged, quoted only when it needs to be, as Python's shlex.quote does.
function shell_word(text: string): string {
  if (text === "") return "''";
  if (/^[\w@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}
