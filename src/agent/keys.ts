// A host's agent key: an ed25519 key made by `ssh-keygen -t ed25519 -N ""`, whose private half the agent holds and
// whose public line the server's config declares. The agent proves it holds the key by signing the server's nonce. The
// server may hold an ed25519 key of its own in the same format, whose public line each agent lists to check the server.
// sshpk reads and writes the OpenSSH formats, which Node's crypto does not, and Node's crypto signs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";

import sshpk from "sshpk";

// ── Settings ─────────────────────────────────────────────────────────────────

export class AgentKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentKeyError";
  }
}

// ── Challenge ────────────────────────────────────────────────────────────────

// What the agent signs: the app, the protocol, the host it logs in as and the server's nonce, so a signature fits one
// login to one app only; `app` is the app's name, such as "x-nix".
export function challenge_text(app: string, host: string, nonce: string): Buffer {
  return Buffer.from(`${app}-agent-v1|${host}|${nonce}`, "utf8");
}

export function sign_challenge(private_key: KeyObject, app: string, host: string, nonce: string): string {
  return sign(null, challenge_text(app, host, nonce), private_key).toString("base64");
}

export function verify_challenge(public_key: KeyObject, app: string, host: string, nonce: string, signature: string): boolean {
  try {
    return verify(null, challenge_text(app, host, nonce), public_key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// ── Server signatures ────────────────────────────────────────────────────────

// What a signature covers: each part as a netstring, its UTF-8 length in bytes in decimal, a colon, its bytes and a comma, so no two lists of parts give the same bytes.
export function signed_bytes(parts: readonly string[]): Buffer {
  return Buffer.concat(parts.map((part) => {
    const bytes = Buffer.from(part, "utf8");
    return Buffer.concat([Buffer.from(`${bytes.length}:`, "utf8"), bytes, Buffer.from(",", "utf8")]);
  }));
}

// What the server signs in its challenge: the app, the host logging in, the server's nonce and its key's fingerprint.
export function server_challenge_text(app: string, host: string, server_nonce: string, server_key_fingerprint: string): Buffer {
  return signed_bytes(["agent-server-challenge-v1", app, host, server_nonce, server_key_fingerprint]);
}

// What an agent that checks the server signs in its hello: the app, its host, both nonces and the server key's fingerprint, so a relayed hello fits no other connection or server.
export function agent_hello_text(app: string, host: string, server_nonce: string, agent_nonce: string, server_key_fingerprint: string): Buffer {
  return signed_bytes(["agent-hello-v2", app, host, server_nonce, agent_nonce, server_key_fingerprint]);
}

// What the server signs for each message after the hello: the app, the host, both nonces of this connection, the message's counter and the exact text of the message.
export function server_message_text(app: string, host: string, server_nonce: string, agent_nonce: string, counter: number, message_text: string): Buffer {
  return signed_bytes(["agent-server-message-v1", app, host, server_nonce, agent_nonce, String(counter), message_text]);
}

export function sign_text(private_key: KeyObject, text: Buffer): string {
  return sign(null, text, private_key).toString("base64");
}

export function verify_text(public_key: KeyObject, text: Buffer, signature: unknown): boolean {
  if (typeof signature !== "string") return false;
  try {
    return verify(null, text, public_key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// A new random nonce of 32 bytes as base64url text.
export function new_nonce(): string {
  return randomBytes(32).toString("base64url");
}

// Whether a text has the shape of a nonce one side made, so the other side keeps no unbounded text.
export function is_nonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

// The accepted server keys from their OpenSSH public lines, by fingerprint; a line that is not an ed25519 key throws an AgentKeyError.
export function parse_server_keys(lines: readonly string[]): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  for (const line of lines) {
    const key = parse_public_key(line);
    keys.set(fingerprint_of(key), key);
  }
  return keys;
}

// ── Public key ───────────────────────────────────────────────────────────────

// The 32 bytes of an ed25519 key's public half, from the public key or its private key.
function raw_public_key(key: KeyObject): Buffer {
  const public_key = key.type === "private" ? createPublicKey(key) : key;
  if (public_key.asymmetricKeyType !== "ed25519") throw new AgentKeyError(`must be an ed25519 key, not ${public_key.asymmetricKeyType ?? public_key.type}.`);
  return Buffer.from(public_key.export({ format: "jwk" }).x!, "base64url");
}

// The key in the SSH wire format an OpenSSH public line carries as base64.
function ssh_public_blob(key: KeyObject): Buffer {
  const field = (bytes: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  return Buffer.concat([field(Buffer.from("ssh-ed25519", "utf8")), field(raw_public_key(key))]);
}

// The OpenSSH public line of an ed25519 key, from the public key or its private key, as ssh-keygen -y prints it.
export function public_key_line(key: KeyObject, comment = ""): string {
  const line = `ssh-ed25519 ${ssh_public_blob(key).toString("base64")}`;
  return comment === "" ? line : `${line} ${comment}`;
}

// The OpenSSH public line of an unencrypted OpenSSH ed25519 private key's text, for an operator to put in each agent's config.
export function public_line_of_private_text(text: string, comment = ""): string {
  return public_key_line(parse_private_key(text), comment);
}

// The SHA256 fingerprint of an ed25519 key, from the public key or its private key, as ssh-keygen -l prints it.
export function fingerprint_of(key: KeyObject): string {
  return `SHA256:${createHash("sha256").update(ssh_public_blob(key)).digest("base64").replace(/=+$/, "")}`;
}

// Reads an OpenSSH public key line; the messages never quote the key itself.
export function parse_public_key(line: string): KeyObject {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2 || parts[0] === "") throw new AgentKeyError('must be an OpenSSH public key line such as "ssh-ed25519 AAAA... comment".');
  if (parts[0] !== "ssh-ed25519") throw new AgentKeyError(`must be an ssh-ed25519 key, not ${parts[0]}; make one with ssh-keygen -t ed25519.`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1])) throw new AgentKeyError("holds a key that is not base64.");
  let key: sshpk.Key;
  try {
    key = sshpk.parseKey(line.trim(), "ssh");
  } catch {
    throw new AgentKeyError("is cut short or damaged.");
  }
  if (key.type !== "ed25519") throw new AgentKeyError(`says ssh-ed25519 but holds a ${key.type} key.`);
  return createPublicKey(key.toString("pkcs8"));
}

// The key's SHA256 fingerprint as ssh-keygen -l prints it.
export function key_fingerprint(line: string): string {
  return sshpk.parseKey(line.trim(), "ssh").fingerprint("sha256").toString();
}

// ── Private key ──────────────────────────────────────────────────────────────

// Reads an unencrypted OpenSSH ed25519 private key; the messages never quote the key itself.
export function parse_private_key(text: string): KeyObject {
  if (!/-{5}BEGIN OPENSSH PRIVATE KEY-{5}/.test(text)) throw new AgentKeyError('is not an OpenSSH private key; make one with ssh-keygen -t ed25519 -N "".');
  let key: sshpk.PrivateKey;
  try {
    key = sshpk.parsePrivateKey(text, "ssh");
  } catch (error) {
    if ((error as Error).name === "KeyEncryptedError") {
      throw new AgentKeyError('is encrypted with a passphrase, which the agent cannot type; make it with -N "" and keep it in a secret store instead.');
    }
    throw new AgentKeyError("is cut short or damaged.");
  }
  if (key.type !== "ed25519") throw new AgentKeyError(`must be an ssh-ed25519 key, not ${key.type}; make one with ssh-keygen -t ed25519.`);
  return createPrivateKey(key.toString("pkcs8"));
}

// ── New keys ─────────────────────────────────────────────────────────────────

// A new ed25519 key in the files ssh-keygen would write: the unencrypted OpenSSH private key and its public line.
export function generate_agent_key(comment: string): { private_text: string; public_line: string } {
  const key = sshpk.generatePrivateKey("ed25519");
  key.comment = comment;
  return { private_text: key.toString("ssh"), public_line: key.toPublic().toString("ssh") };
}
