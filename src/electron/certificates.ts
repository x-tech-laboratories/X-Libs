// Certificates the user chose to trust, honoured by Chromium's network stack: the window's own loads, and the main
// process's requests when they go through trusting_fetch instead of Node's fetch, such as the sync client's.

import { fingerprint_of } from "../certificates.ts";

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron these helpers use, so this module builds without Electron installed.
export interface CertificateVerifyRequestLike {
  hostname: string;
  certificate: { data: string };
  // Chromium's own verdict, 0 when it accepts the certificate.
  errorCode: number;
}

export interface SessionLike {
  setCertificateVerifyProc(proc: ((request: CertificateVerifyRequestLike, callback: (verdict: number) => void) => void) | null): void;
}

export interface FetchingSessionLike extends SessionLike {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

// Electron's session module, which makes a session of its own for a partition name.
export interface SessionsLike {
  fromPartition(partition: string): FetchingSessionLike;
}

// The trust store's side, such as create_certificate_trust's.
export interface TrustLike {
  is_trusted: (host: string, fingerprint: string) => boolean;
  on_change: (listener: () => void) => () => void;
}

const ACCEPT = 0;
const USE_CHROMIUM_VERDICT = -3;

// ── Trusting ─────────────────────────────────────────────────────────────────

// Accepts a certificate Chromium refuses only when the user trusted that exact one for that host; returns how to stop.
export function trust_in_session(session: SessionLike, is_trusted: (host: string, fingerprint: string) => boolean): () => void {
  session.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === ACCEPT) return callback(USE_CHROMIUM_VERDICT);
    try {
      callback(is_trusted(request.hostname, fingerprint_of(request.certificate.data)) ? ACCEPT : USE_CHROMIUM_VERDICT);
    } catch {
      callback(USE_CHROMIUM_VERDICT);
    }
  });
  return () => session.setCertificateVerifyProc(null);
}

let next_partition = 0;

// A fetch over Chromium for the sync client or create_main_fetch, moved to a fresh session whenever the trusted certificates change, since a session keeps refusing a certificate it once refused.
export function trusting_fetch(sessions: SessionsLike, trust: TrustLike): typeof fetch {
  const fresh_session = () => {
    const session = sessions.fromPartition(`x-libs-certificates-${Date.now()}-${next_partition++}`);
    trust_in_session(session, trust.is_trusted);
    return session;
  };
  let session = fresh_session();
  trust.on_change(() => { session = fresh_session(); });
  return (input, init) => session.fetch(input instanceof URL ? input.href : input, init);
}
