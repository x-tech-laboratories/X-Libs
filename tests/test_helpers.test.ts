import { X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { memory_connection_storage } from "../src/connection_protocol.ts";
import { free_port, make_checkout, self_signed_certificate, temp_folder } from "../src/test_helpers.ts";

describe("test helpers", () => {
  it("find a free loopback port and make throwaway folders and a checkout with one commit", async () => {
    const port = await free_port();
    const checkout = make_checkout();

    expect(port).toBeGreaterThan(0);
    expect(temp_folder("x-libs-helper")).toMatch(/x-libs-helper-/);
    expect(execFileSync("git", ["log", "--format=%s"], { cwd: checkout, encoding: "utf8" }).trim()).toBe("chore: start");
    expect(existsSync(join(checkout, "README.md"))).toBe(true);
  });

  it("make a certificate that signs itself for localhost, which a server can listen with", async () => {
    const { certificate_file, key_file } = self_signed_certificate();
    const certificate = new X509Certificate(readFileSync(certificate_file));

    expect(certificate.subject).toBe("CN=localhost");
    expect(certificate.subjectAltName).toContain("IP Address:127.0.0.1");
    const server = createServer({ cert: readFileSync(certificate_file), key: readFileSync(key_file) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  it("keep the daemons a device knows in memory", () => {
    const storage = memory_connection_storage();
    expect(storage.read()).toBeNull();

    storage.write({ chosen: "local", remotes: [] } as never);

    expect(storage.read()).toEqual({ chosen: "local", remotes: [] });
  });
});
