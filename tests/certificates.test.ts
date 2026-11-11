// Certificates for tests are made with openssl in a test's own folder, so no key is ever kept in the repository.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { check_certificate, create_certificate_trust } from "../src/certificates.ts";
import { trust_in_session, trusting_fetch, type CertificateVerifyRequestLike, type FetchingSessionLike } from "../src/electron/certificates.ts";

const folder = mkdtempSync(join(tmpdir(), "x-libs-certificates-"));

function openssl(...args: string[]): void {
  execFileSync("openssl", args, { cwd: folder, stdio: "ignore" });
}

// A certificate that signs itself for the name, as a home server's often does.
function self_signed(name: string, host_name: string): { key: string; cert: string } {
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "30", "-subj", `/CN=${host_name}`, "-addext", `subjectAltName=DNS:${host_name}`);
  return { key: readFileSync(join(folder, `${name}.key`), "utf8"), cert: readFileSync(join(folder, `${name}.pem`), "utf8") };
}

// A certificate from a private authority the server does not send.
function from_private_authority(): { key: string; cert: string } {
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "root.key", "-out", "root.pem", "-days", "30", "-subj", "/CN=Home Root");
  openssl("req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=localhost");
  writeFileSync(join(folder, "leaf.ext"), "subjectAltName=DNS:localhost\n");
  openssl("x509", "-req", "-in", "leaf.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "30", "-extfile", "leaf.ext");
  return { key: readFileSync(join(folder, "leaf.key"), "utf8"), cert: readFileSync(join(folder, "leaf.pem"), "utf8") };
}

const servers: Server[] = [];

function serve(credentials: { key: string; cert: string }): Promise<string> {
  const server = createServer(credentials, (_request, response) => response.end("hello"));
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`https://localhost:${(server.address() as AddressInfo).port}/`)));
}

let self_signed_url = "";
let wrong_name_url = "";
let private_authority_url = "";

beforeAll(async () => {
  self_signed_url = await serve(self_signed("home", "localhost"));
  wrong_name_url = await serve(self_signed("other", "nas.lan"));
  private_authority_url = await serve(from_private_authority());
});

afterAll(() => {
  for (const server of servers) server.close();
});

// ============================================================================
// Checking
// ============================================================================

describe("check_certificate", () => {
  it("reads a self-signed certificate and says what is wrong with it", async () => {
    const check = await check_certificate(self_signed_url);

    expect(check).toMatchObject({ host: "localhost", problems: ["self_signed"], reason: "DEPTH_ZERO_SELF_SIGNED_CERT", trusted: false });
    expect(check!.chain[0]).toMatchObject({ subject: "CN=localhost", issuer: "CN=localhost", alt_names: ["DNS:localhost"] });
    expect(check!.chain[0]!.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(check!.chain[0]!.pem).toMatch(/^-----BEGIN CERTIFICATE-----/);
  });

  it("also finds a name that does not match and dates that have passed, which TLS stops before", async () => {
    expect((await check_certificate(wrong_name_url))!.problems).toEqual(["self_signed", "wrong_host"]);
    expect((await check_certificate(self_signed_url, { now: new Date(Date.now() + 365 * 24 * 3600 * 1000) }))!.problems).toEqual(["self_signed", "expired"]);
  });

  it("tells a private authority from a self-signed certificate", async () => {
    expect((await check_certificate(private_authority_url))!.problems).toEqual(["unknown_authority"]);
  });

  it("answers null for plain http, a bad address, or a server that does not answer", async () => {
    expect(await check_certificate("http://localhost/")).toBeNull();
    expect(await check_certificate("not a url")).toBeNull();
    expect(await check_certificate("https://127.0.0.1:1/", { timeout_ms: 2000 })).toBeNull();
  });
});

// ============================================================================
// Trusting
// ============================================================================

describe("create_certificate_trust", () => {
  it("trusts the certificate the user saw for its host only, and Node's fetch then reaches the server", async () => {
    const file = join(folder, "profile", "trusted-certificates.json");
    const trust = create_certificate_trust({ file, use_in_node: true });
    await expect(fetch(self_signed_url)).rejects.toThrow();
    const check = (await trust.methods.check_certificate(self_signed_url))!;

    const list = await trust.methods.trust_certificate(self_signed_url, check.chain[0]!.fingerprint);

    expect(list).toEqual([expect.objectContaining({ host: "localhost", subject: "CN=localhost", problems: ["self_signed"] })]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(list);
    expect(trust.is_trusted("localhost", check.chain[0]!.fingerprint)).toBe(true);
    expect(trust.is_trusted("nas.lan", check.chain[0]!.fingerprint)).toBe(false);
    expect((await trust.methods.check_certificate(self_signed_url))!.trusted).toBe(true);
    expect(await (await fetch(self_signed_url)).text()).toBe("hello");
    expect(create_certificate_trust({ file }).read()).toEqual(list);
  });

  it("refuses a fingerprint the server no longer shows, and forgets a host", async () => {
    const trust = create_certificate_trust({ file: join(folder, "forget.json") });
    const check = (await trust.methods.check_certificate(wrong_name_url))!;

    await expect(trust.methods.trust_certificate(wrong_name_url, "AA:BB")).rejects.toThrow("now shows a different certificate");
    await trust.methods.trust_certificate(wrong_name_url, check.chain[0]!.fingerprint);

    expect(trust.methods.forget_certificate("localhost")).toEqual([]);
  });

  it("reads a malformed file as nothing trusted", () => {
    const file = join(folder, "broken.json");
    writeFileSync(file, "{ not json");

    expect(create_certificate_trust({ file }).read()).toEqual([]);
  });
});

// ============================================================================
// Electron
// ============================================================================

describe("trust_in_session", () => {
  it("accepts a refused certificate only when that one is trusted for that host, and leaves the rest to Chromium", async () => {
    let verify: ((request: CertificateVerifyRequestLike, callback: (verdict: number) => void) => void) | null = null;
    const session = { setCertificateVerifyProc: (proc: typeof verify) => { verify = proc; } };
    const pem = (await check_certificate(self_signed_url))!.chain[0]!.pem;
    const trusted = create_certificate_trust({ file: join(folder, "session.json") });
    await trusted.methods.trust_certificate(self_signed_url, (await check_certificate(self_signed_url))!.chain[0]!.fingerprint);
    const verdict = (request: CertificateVerifyRequestLike) => new Promise((resolve) => verify!(request, resolve));

    const stop = trust_in_session(session, trusted.is_trusted);

    expect(await verdict({ hostname: "localhost", certificate: { data: pem }, errorCode: -202 })).toBe(0);
    expect(await verdict({ hostname: "nas.lan", certificate: { data: pem }, errorCode: -202 })).toBe(-3);
    expect(await verdict({ hostname: "localhost", certificate: { data: "garbage" }, errorCode: -202 })).toBe(-3);
    expect(await verdict({ hostname: "example.org", certificate: { data: pem }, errorCode: 0 })).toBe(-3);
    stop();
    expect(verify).toBeNull();
  });
});

describe("trusting_fetch", () => {
  it("moves to a fresh session each time a certificate is trusted or forgotten, since a session keeps its refusals", async () => {
    const made: string[] = [];
    const sessions = {
      fromPartition: (partition: string): FetchingSessionLike => {
        made.push(partition);
        return { setCertificateVerifyProc: () => {}, fetch: async (input) => new Response(`${partition} ${String(input)}`) };
      },
    };
    const trust = create_certificate_trust({ file: join(folder, "fetch.json") });
    const send = trusting_fetch(sessions, trust);
    expect(made).toEqual([]);

    const first = await (await send(new URL("https://nas.lan/a"))).text();
    await trust.methods.trust_certificate(self_signed_url, (await check_certificate(self_signed_url))!.chain[0]!.fingerprint);
    const second = await (await send("https://nas.lan/b")).text();

    expect(made).toHaveLength(2);
    expect(first).toBe(`${made[0]} https://nas.lan/a`);
    expect(second).toBe(`${made[1]} https://nas.lan/b`);
  });
});
