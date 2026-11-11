// What a page and its app say about a server whose https certificate this device does not accept, such as a home
// server's self-signed one: what is wrong with it, the certificate itself, and the user's choice to trust it anyway.

// ── Certificates ─────────────────────────────────────────────────────────────

// Why the certificate is not accepted, worst first when there are several.
export type CertificateProblem = "self_signed" | "unknown_authority" | "wrong_host" | "expired" | "not_yet_valid" | "other";

export interface CertificateDetails {
  // Who it was issued to and by, read from the common name up, such as "CN=nas.lan, O=Home".
  subject: string;
  issuer: string;
  // The other names it covers, such as "DNS:nas.lan" and "IP Address:192.168.1.5".
  alt_names: string[];
  valid_from: string;
  valid_to: string;
  // The SHA-256 fingerprint as colon-separated hex, which the user can check against the server's own copy.
  fingerprint: string;
  serial_number: string;
  pem: string;
}

export interface CertificateCheck {
  // The scheme, host and port that was checked, such as "https://nas.lan:8443".
  origin: string;
  host: string;
  problems: CertificateProblem[];
  // The words the TLS library gave, such as "DEPTH_ZERO_SELF_SIGNED_CERT", for the curious.
  reason: string;
  // The server's own certificate first, then each one it sent that vouches for it.
  chain: CertificateDetails[];
  // Whether the user already chose to trust this exact certificate for this host.
  trusted: boolean;
}

// A certificate the user chose to trust for one host, whatever was wrong with it.
export interface TrustedCertificate {
  host: string;
  fingerprint: string;
  subject: string;
  problems: CertificateProblem[];
  pem: string;
  trusted_at: string;
}

// ── Calls ────────────────────────────────────────────────────────────────────

// What the page asks of the app that makes its connections, such as through Electron's preload.
export interface CertificateMethods {
  // The certificate behind an https address and what is wrong with it, or null when it is fine, not https, or unreachable.
  check_certificate: (url: string) => Promise<CertificateCheck | null>;
  // Trusts the certificate the host shows now, refused when it no longer has the fingerprint the user saw.
  trust_certificate: (url: string, fingerprint: string) => Promise<TrustedCertificate[]>;
  list_trusted_certificates: () => TrustedCertificate[];
  forget_certificate: (host: string) => TrustedCertificate[];
}

export const certificate_method_names = ["check_certificate", "trust_certificate", "list_trusted_certificates", "forget_certificate"] as const satisfies readonly (keyof CertificateMethods)[];

// The same calls as the page makes them, each answered later, as a bridge's client gives them.
export type CertificateClient = { [Name in keyof CertificateMethods]: (...args: Parameters<CertificateMethods[Name]>) => Promise<Awaited<ReturnType<CertificateMethods[Name]>>> };

// ── Words ────────────────────────────────────────────────────────────────────

// Each problem in a sentence the user can act on.
export const certificate_problem_text: Record<CertificateProblem, string> = {
  self_signed: "The certificate is self-signed: the server vouches for itself, and no authority this device knows has checked it.",
  unknown_authority: "The certificate comes from an authority this device does not know, such as a private one set up for a home network.",
  wrong_host: "The certificate is for a different name than the address being reached, so it may belong to another server.",
  expired: "The certificate has expired.",
  not_yet_valid: "The certificate is not valid yet, or this device's clock is wrong.",
  other: "The certificate could not be checked.",
};

// Only a missing authority is the usual case of a server the user runs themselves; the rest also suggest the wrong server.
export function is_routine_problem(problems: readonly CertificateProblem[]): boolean {
  return problems.every((problem) => problem === "self_signed" || problem === "unknown_authority");
}
