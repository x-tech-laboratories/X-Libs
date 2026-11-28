import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { read_or_make_peer_certificate } from "../src/peer_certificate.ts";

describe("a desktop's peer certificate", () => {
  it("is made once, self-signed for the computer's addresses, kept only its owner can read, and read back the same", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "x-app-peer-cert-")), "profile", "sync-certificate.json");
    const made = await read_or_make_peer_certificate(file, "x-test on this computer", ["192.168.1.5"]);
    const certificate = new X509Certificate(made.cert);

    expect(certificate.subject).toContain("x-test on this computer");
    expect(certificate.issuer).toBe(certificate.subject);
    expect(certificate.subjectAltName).toContain("IP Address:192.168.1.5");
    expect(certificate.validToDate.getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear() + 9);
    expect(made.fingerprint).toBe(certificate.fingerprint256);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = await read_or_make_peer_certificate(file, "x-test on this computer", []);
    expect(again.fingerprint).toBe(made.fingerprint);
    expect(JSON.parse(readFileSync(file, "utf8"))).not.toHaveProperty("fingerprint");
  });

  it("makes a new one in place of a damaged file", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "x-app-peer-cert-")), "sync-certificate.json");
    writeFileSync(file, "not json");
    const made = await read_or_make_peer_certificate(file, "x-test on this computer", []);
    expect(new X509Certificate(made.cert).fingerprint256).toBe(made.fingerprint);
  });
});
