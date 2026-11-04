// A host's agent key: an ed25519 key made by `ssh-keygen -t ed25519 -N ""`, whose private half the agent holds and
// whose public line the server's config declares. The agent proves it holds the key by signing the server's nonce.
// sshpk reads and writes the OpenSSH formats, which Node's crypto does not, and Node's crypto signs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

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

// ── Public key ───────────────────────────────────────────────────────────────

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
