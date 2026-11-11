// Servers whose https certificate this device does not accept, such as a home server's self-signed one: reading the
// certificate and what is wrong with it, and keeping the ones the user chose to trust, each for its own host only.

// ── Imports ──────────────────────────────────────────────────────────────────

import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname } from "node:path";
import tls, { type DetailedPeerCertificate } from "node:tls";

import type { CertificateCheck, CertificateDetails, CertificateMethods, CertificateProblem, TrustedCertificate } from "./certificate_protocol.ts";

export type { CertificateCheck, CertificateDetails, CertificateMethods, CertificateProblem, TrustedCertificate };

// ── Reading certificates ─────────────────────────────────────────────────────

// OpenSSL lists the name parts from the country down; this reads them from the common name up, as people do.
function name_of(lines: string): string {
  return lines.split("\n").filter(Boolean).reverse().join(", ");
}

export function describe_certificate(certificate: X509Certificate): CertificateDetails {
  return {
    subject: name_of(certificate.subject),
    issuer: name_of(certificate.issuer),
    alt_names: certificate.subjectAltName ? certificate.subjectAltName.split(", ") : [],
    valid_from: certificate.validFromDate.toISOString(),
    valid_to: certificate.validToDate.toISOString(),
    fingerprint: certificate.fingerprint256,
    serial_number: certificate.serialNumber,
    pem: certificate.toString().trim(),
  };
}

// The SHA-256 fingerprint of a PEM certificate, in the same form as CertificateDetails.
export function fingerprint_of(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

// The server's certificate and each one above it that it sent, stopping at one that signs itself.
function chain_of(peer: DetailedPeerCertificate): X509Certificate[] {
  const chain: X509Certificate[] = [];
  let current: DetailedPeerCertificate | undefined = peer;
  while (current?.raw && chain.length < 10) {
    chain.push(new X509Certificate(current.raw));
    if (current.issuerCertificate === current) break;
    current = current.issuerCertificate;
  }
  return chain;
}

// ── Checking a server ────────────────────────────────────────────────────────

const PROBLEM_OF_CODE: Record<string, CertificateProblem> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: "self_signed",
  SELF_SIGNED_CERT_IN_CHAIN: "unknown_authority",
  UNABLE_TO_GET_ISSUER_CERT: "unknown_authority",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "unknown_authority",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "unknown_authority",
  CERT_HAS_EXPIRED: "expired",
  CERT_NOT_YET_VALID: "not_yet_valid",
  ERR_TLS_CERT_ALTNAME_INVALID: "wrong_host",
};

const PROBLEM_ORDER: CertificateProblem[] = ["self_signed", "unknown_authority", "wrong_host", "expired", "not_yet_valid", "other"];

const DEFAULT_TIMEOUT_MS = 10_000;

// The host as Chromium names it, without the brackets around an IPv6 address.
export function host_of(url: string): string {
  return new URL(url).hostname.replace(/^\[(.*)\]$/, "$1");
}

// TLS stops at the first problem it finds, so the name and dates are checked here as well.
function problems_of(code: string, host: string, peer: DetailedPeerCertificate, leaf: X509Certificate, now: Date): CertificateProblem[] {
  const found = new Set<CertificateProblem>();
  if (code) found.add(PROBLEM_OF_CODE[code] ?? "other");
  if (tls.checkServerIdentity(host, peer)) found.add("wrong_host");
  if (leaf.validToDate < now) found.add("expired");
  if (leaf.validFromDate > now) found.add("not_yet_valid");
  return PROBLEM_ORDER.filter((problem) => found.has(problem));
}

export interface CheckOptions {
  timeout_ms?: number;
  // The authorities a certificate is checked against; the ones Node ships and the system's unless set.
  authorities?: string[];
  now?: Date;
}

// Connects without checking the certificate, only to read it; nothing is sent over the connection.
export function check_certificate(url: string, options: CheckOptions = {}): Promise<CertificateCheck | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(null);
  }
  if (parsed.protocol !== "https:") return Promise.resolve(null);

  const host = host_of(url);
  const authorities = options.authorities ?? [...tls.getCACertificates("bundled"), ...tls.getCACertificates("system")];

  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: Number(parsed.port || 443), servername: isIP(host) ? undefined : host, ca: authorities, rejectUnauthorized: false });
    socket.setTimeout(options.timeout_ms ?? DEFAULT_TIMEOUT_MS, () => socket.destroy());
    socket.once("error", () => resolve(null));
    socket.once("close", () => resolve(null));
    socket.once("secureConnect", () => {
      // Node types this as an Error but hands over the OpenSSL code as a plain string.
      const code = socket.authorizationError ? String(socket.authorizationError) : "";
      const peer = socket.getPeerCertificate(true);
      socket.destroy();
      if (!peer.raw) return resolve(null);

      const chain = chain_of(peer);
      const problems = problems_of(code, host, peer, chain[0]!, options.now ?? new Date());
      if (problems.length === 0) return resolve(null);
      resolve({ origin: parsed.origin, host, problems, reason: code || problems.join(", "), chain: chain.map(describe_certificate), trusted: false });
    });
  });
}

// ── Trusted certificates ─────────────────────────────────────────────────────

export interface CertificateTrustOptions {
  // The JSON file of trusted certificates, such as "<profile>/trusted-certificates.json"; its folder is made when missing.
  file: string;
  // Also hands each trusted certificate to Node's own https, which then accepts a self-signed server whose name matches.
  use_in_node?: boolean;
  // Runs before every write of the file, such as the app's write guard.
  before_write?: (path: string) => void;
  check?: (url: string) => Promise<CertificateCheck | null>;
}

export type CertificateTrust = ReturnType<typeof create_certificate_trust>;

export function create_certificate_trust(options: CertificateTrustOptions) {
  const check = options.check ?? ((url: string) => check_certificate(url));

  let trusted = read_trusted(options.file);
  const listeners = new Set<() => void>();
  const read = () => trusted;

  // Writes beside the file and renames over it, so a crash mid-write never leaves half a file.
  function write(list: TrustedCertificate[]): TrustedCertificate[] {
    options.before_write?.(options.file);
    mkdirSync(dirname(options.file), { recursive: true });
    writeFileSync(`${options.file}.tmp`, JSON.stringify(list, null, 2));
    renameSync(`${options.file}.tmp`, options.file);
    trusted = list;
    if (options.use_in_node) use_in_node(list);
    for (const listener of listeners) listener();
    return list;
  }

  // Read from memory, since Chromium asks on every connection.
  function is_trusted(host: string, fingerprint: string): boolean {
    return trusted.some((entry) => entry.host === host && entry.fingerprint === fingerprint);
  }

  const methods: CertificateMethods = {
    check_certificate: async (url) => {
      const found = await check(url);
      return found && { ...found, trusted: is_trusted(found.host, found.chain[0]!.fingerprint) };
    },
    trust_certificate: async (url, fingerprint) => {
      const found = await check(url);
      const leaf = found?.chain[0];
      if (!found || !leaf) throw new Error(`${new URL(url).host} no longer shows a certificate that needs trusting`);
      if (leaf.fingerprint !== fingerprint) throw new Error(`${found.host} now shows a different certificate; check it again before trusting it`);
      const entry: TrustedCertificate = { host: found.host, fingerprint, subject: leaf.subject, problems: found.problems, pem: leaf.pem, trusted_at: new Date().toISOString() };
      return write([...read().filter((other) => other.host !== found.host), entry]);
    },
    list_trusted_certificates: read,
    forget_certificate: (host) => write(read().filter((entry) => entry.host !== host)),
  };

  if (options.use_in_node) use_in_node(read());

  // Runs whenever a certificate is trusted or forgotten; returns how to stop.
  function on_change(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  return { methods, read, is_trusted, on_change };
}

// A missing or malformed file reads as nothing trusted.
function read_trusted(file: string): TrustedCertificate[] {
  try {
    const list = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as TrustedCertificate[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Node's https trusts only its own list, so the system's authorities and the trusted certificates are added to it.
function use_in_node(list: TrustedCertificate[]): void {
  tls.setDefaultCACertificates([...new Set([...tls.getCACertificates("bundled"), ...tls.getCACertificates("system"), ...list.map((entry) => entry.pem)])]);
}
