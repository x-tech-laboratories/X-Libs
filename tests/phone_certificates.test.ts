import { describe, expect, it, vi } from "vitest";

import type { CertificateCheck, TrustedCertificate } from "../src/certificate_protocol.ts";
import { phone_certificates, type CertificatesPlugin } from "../src/phone_certificates.ts";

const check: CertificateCheck = { origin: "https://nas.lan", host: "nas.lan", problems: ["self_signed"], reason: "", chain: [], trusted: false };
const trusted: TrustedCertificate[] = [{ host: "nas.lan", fingerprint: "AB:CD", subject: "CN=nas.lan", problems: ["self_signed"], pem: "", trusted_at: "2026-11-11T00:00:00Z" }];

describe("phone_certificates", () => {
  it("unwraps each plugin answer into the calls the page makes", async () => {
    const plugin: CertificatesPlugin = {
      check: vi.fn(async () => ({ check })),
      trust: vi.fn(async () => ({ certificates: trusted })),
      list: vi.fn(async () => ({ certificates: trusted })),
      forget: vi.fn(async () => ({ certificates: [] })),
    };
    const certificates = phone_certificates(plugin);

    expect(await certificates.check_certificate("https://nas.lan/")).toEqual(check);
    expect(await certificates.trust_certificate("https://nas.lan/", "AB:CD")).toEqual(trusted);
    expect(await certificates.list_trusted_certificates()).toEqual(trusted);
    expect(await certificates.forget_certificate("nas.lan")).toEqual([]);
    expect(plugin.trust).toHaveBeenCalledWith({ url: "https://nas.lan/", fingerprint: "AB:CD" });
    expect(plugin.forget).toHaveBeenCalledWith({ host: "nas.lan" });
  });

  it("reads a failed check as nothing to offer", async () => {
    const plugin = { check: async () => { throw new Error("unreachable"); } } as unknown as CertificatesPlugin;

    expect(await phone_certificates(plugin).check_certificate("https://nas.lan/")).toBeNull();
  });
});
