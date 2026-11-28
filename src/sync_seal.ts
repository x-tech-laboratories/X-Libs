// The keys paired devices know each other by and the seal on every call between them, on tweetnacl's box (X25519 with
// XSalsa20-Poly1305): only the two devices can open a call or its answer, each knows the other made it, and so a call
// may travel over plain http on a home network as safely as over https. Runs on Node, in a desktop page and in a phone's page.

// ── Imports ──────────────────────────────────────────────────────────────────

import nacl from "tweetnacl";

import type { PairingOffer, PeerIdentity } from "./sync_protocol.ts";

// ── Bytes ────────────────────────────────────────────────────────────────────

export function to_base64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

export function from_base64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

const base32_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function to_base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += base32_letters[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) text += base32_letters[(value << (5 - bits)) & 31];
  return text;
}

// ── Identity ─────────────────────────────────────────────────────────────────

const device_id_bytes = 20;

// A device's id is a hash of its public key, so a key can be checked against the id it claims.
export function device_id_of(public_key: string): string {
  return to_base32(nacl.hash(from_base64(public_key)).subarray(0, device_id_bytes));
}

export function create_identity(): PeerIdentity {
  const keys = nacl.box.keyPair();
  const public_key = to_base64(keys.publicKey);
  return { device: device_id_of(public_key), public_key, secret_key: to_base64(keys.secretKey) };
}

export function random_secret(): string {
  return to_base64(nacl.randomBytes(16));
}

// ── Messages ─────────────────────────────────────────────────────────────────

// A message is its JSON's length in four bytes, the JSON, then any raw bytes, such as a file's.
function frame(json: unknown, bytes: Uint8Array = new Uint8Array()): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const framed = new Uint8Array(4 + text.length + bytes.length);
  new DataView(framed.buffer).setUint32(0, text.length);
  framed.set(text, 4);
  framed.set(bytes, 4 + text.length);
  return framed;
}

function unframe(framed: Uint8Array): { json: unknown; bytes: Uint8Array } | null {
  if (framed.length < 4) return null;
  const length = new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getUint32(0);
  if (4 + length > framed.length) return null;
  try {
    return { json: JSON.parse(new TextDecoder().decode(framed.subarray(4, 4 + length))), bytes: framed.slice(4 + length) };
  } catch {
    return null;
  }
}

export interface Sealed {
  // The nonce in base64, which an answer names to show which call it answers.
  nonce: string;
  body: Uint8Array;
}

// The nonce, then the box; a fresh random nonce each time.
export function seal(json: unknown, bytes: Uint8Array | undefined, their_public_key: string, my_secret_key: string): Sealed {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(frame(json, bytes), nonce, from_base64(their_public_key), from_base64(my_secret_key));
  const body = new Uint8Array(nonce.length + box.length);
  body.set(nonce);
  body.set(box, nonce.length);
  return { nonce: to_base64(nonce), body };
}

// Null when the body was not sealed by the holder of that public key for this device, or was changed on the way.
export function open_sealed(body: Uint8Array, their_public_key: string, my_secret_key: string): { nonce: string; json: unknown; bytes: Uint8Array } | null {
  if (body.length < nacl.box.nonceLength + nacl.box.overheadLength) return null;
  const nonce = body.subarray(0, nacl.box.nonceLength);
  let opened: Uint8Array | null;
  try {
    opened = nacl.box.open(body.subarray(nacl.box.nonceLength), nonce, from_base64(their_public_key), from_base64(my_secret_key));
  } catch {
    return null;
  }
  const message = opened && unframe(opened);
  return message ? { nonce: to_base64(nonce), ...message } : null;
}

// ── Pairing codes ────────────────────────────────────────────────────────────

const code_prefix = "x-sync:";

export function encode_pairing_offer(offer: PairingOffer): string {
  return code_prefix + to_base64(new TextEncoder().encode(JSON.stringify(offer))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// Spaces and line breaks a copy may add are ignored; anything that is not a whole code throws in plain words.
export function decode_pairing_offer(code: string): PairingOffer {
  const text = code.replace(/\s+/g, "");
  if (!text.startsWith(code_prefix)) throw new Error("that is not a pairing code; it starts with x-sync:");
  let offer: Partial<PairingOffer>;
  try {
    const base64 = text.slice(code_prefix.length).replaceAll("-", "+").replaceAll("_", "/");
    offer = JSON.parse(new TextDecoder().decode(from_base64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")))) as Partial<PairingOffer>;
  } catch {
    throw new Error("the pairing code is cut short or mistyped; copy it again");
  }
  const is_whole =
    typeof offer.app === "string" && typeof offer.device === "string" && typeof offer.public_key === "string" && typeof offer.name === "string" &&
    typeof offer.secret === "string" && Array.isArray(offer.addresses) && offer.addresses.every((address) => typeof address === "string");
  if (!is_whole) throw new Error("the pairing code is cut short or mistyped; copy it again");
  if (device_id_of(offer.public_key!) !== offer.device) throw new Error("the pairing code's key does not match its device; copy it again");
  return offer as PairingOffer;
}
