// Certificates the user chose to trust, honoured by Chromium's network stack: the window's own loads, and the main
// process's requests when they go through Electron's net.fetch instead of Node's, such as the sync client's.

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

export interface NetLike {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
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

// A fetch over Chromium's network stack, for the sync client or create_main_fetch, so trusted certificates hold there too.
export function chromium_fetch(net: NetLike): typeof fetch {
  return (input, init) => net.fetch(input instanceof URL ? input.href : input, init);
}
