// Server certificates on a phone, such as a home sync server's self-signed one: the same calls the desktop app answers,
// answered by X-Libs' XLibsCertificates plugin, which also lets the app's WebView reach the servers the user trusts.

// ── Imports ──────────────────────────────────────────────────────────────────

import { registerPlugin } from "@capacitor/core";

import type { CertificateCheck, CertificateClient, TrustedCertificate } from "./certificate_protocol.ts";

// ── Plugin ───────────────────────────────────────────────────────────────────

export interface CertificatesPlugin {
  check: (options: { url: string }) => Promise<{ check: CertificateCheck | null }>;
  trust: (options: { url: string; fingerprint: string }) => Promise<{ certificates: TrustedCertificate[] }>;
  list: () => Promise<{ certificates: TrustedCertificate[] }>;
  forget: (options: { host: string }) => Promise<{ certificates: TrustedCertificate[] }>;
}

export const certificates_plugin = registerPlugin<CertificatesPlugin>("XLibsCertificates");

// ── Client ───────────────────────────────────────────────────────────────────

// The page's certificate calls on a phone, for SyncSettings, SyncCertificatePrompt and TrustedCertificates.
export function phone_certificates(plugin: CertificatesPlugin = certificates_plugin): CertificateClient {
  return {
    check_certificate: async (url) => (await plugin.check({ url }).catch(() => ({ check: null }))).check,
    trust_certificate: async (url, fingerprint) => (await plugin.trust({ url, fingerprint })).certificates,
    list_trusted_certificates: async () => (await plugin.list()).certificates,
    forget_certificate: async (host) => (await plugin.forget({ host })).certificates,
  };
}
