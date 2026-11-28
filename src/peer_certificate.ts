// The https certificate a desktop daemon answers paired devices with: self-signed, made once on selfsigned and kept
// beside the database, so its fingerprint stays the same and a device that trusted it keeps reaching it. Only this user
// can read the file, since it holds the private key.

// ── Imports ──────────────────────────────────────────────────────────────────

import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";

import { generate } from "selfsigned";

// ── Certificate ──────────────────────────────────────────────────────────────

export interface PeerCertificate {
  cert: string;
  key: string;
  // The SHA-256 fingerprint as colon-separated hex, the form the certificate dialog shows.
  fingerprint: string;
}

const valid_years = 10;

// The names and addresses the certificate covers, so a device reaching one of them sees no wrong-name problem.
function alt_names(addresses: readonly string[]): { type: 2 | 7; value?: string; ip?: string }[] {
  return [{ type: 2, value: hostname() }, { type: 2, value: `${hostname()}.local` }, { type: 2, value: "localhost" }, ...addresses.map((ip) => ({ type: 7 as const, ip }))];
}

export async function make_peer_certificate(name: string, addresses: readonly string[]): Promise<PeerCertificate> {
  const now = new Date();
  const until = new Date(now);
  until.setFullYear(until.getFullYear() + valid_years);
  const made = await generate([{ name: "commonName", value: name }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate: now,
    notAfterDate: until,
    extensions: [{ name: "subjectAltName", altNames: alt_names(addresses) }],
  });
  return { cert: made.cert, key: made.private, fingerprint: new X509Certificate(made.cert).fingerprint256 };
}

// Reads the kept certificate, or makes and keeps one when there is none or the file is damaged.
export async function read_or_make_peer_certificate(file: string, name: string, addresses: readonly string[]): Promise<PeerCertificate> {
  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<PeerCertificate>;
      if (typeof saved.cert === "string" && typeof saved.key === "string") return { cert: saved.cert, key: saved.key, fingerprint: new X509Certificate(saved.cert).fingerprint256 };
    }
  } catch {
    // A damaged file is replaced by a new certificate below.
  }
  const made = await make_peer_certificate(name, addresses);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ cert: made.cert, key: made.key }, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  return made;
}
