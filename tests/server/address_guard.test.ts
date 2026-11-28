import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checked_web_address, guarded_lookup, is_public_address, ports_of, public_addresses, type GuardOptions } from "../../src/server/address_guard.ts";

describe("public addresses", () => {
  it("knows public addresses from loopback, private, link-local and other ranges, in IPv4 and IPv6", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) expect(is_public_address(address), address).toBe(true);
    for (const address of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "2001:db8::1", "fe80::1%eth0", "not an address",
    ]) {
      expect(is_public_address(address), address).toBe(false);
    }
  });
});

describe("checked_web_address", () => {
  it("takes only whole http and https addresses, without a name or password, on the usual ports unless allowed", () => {
    expect(checked_web_address("https://example.org/a#b").href).toBe("https://example.org/a");
    expect(checked_web_address("http://example.org:80/").href).toBe("http://example.org/");
    expect(() => checked_web_address("example.org")).toThrow("Give a whole web address");
    expect(() => checked_web_address("file:///etc/passwd")).toThrow("Only http and https addresses can be read, not file.");
    expect(() => checked_web_address("ftp://example.org/")).toThrow("not ftp");
    expect(() => checked_web_address(["https://someone", "word@example.org/"].join(":"))).toThrow("name or password");
    expect(() => checked_web_address("https://someone@example.org/")).toThrow("name or password");
    expect(() => checked_web_address("https://example.org:8443/")).toThrow("Port 8443 is not allowed; only 80 and 443 are.");
    expect(() => checked_web_address("https://example.org:8443/", { ports_hint: "unless Settings → Web lists others" })).toThrow("only 80 and 443 are, unless Settings → Web lists others.");
    expect(checked_web_address("https://example.org:8443/", { allowed_ports: ports_of("8080, 8443") }).port).toBe("8443");
    expect([...ports_of("80 x 70000, 8080;-1")]).toEqual([80, 8080]);
    expect([...ports_of(undefined)]).toEqual([]);
  });
});

describe("public_addresses", () => {
  it("refuses a name that resolves to any address not public, and lets a test allow one only by its own allowance", async () => {
    const answers: Record<string, string[]> = { "public.test": ["93.184.216.34"], "mixed.test": ["93.184.216.34", "10.0.0.5"], "nothing.test": [] };
    const resolve = async (host: string) => answers[host] ?? Promise.reject(new Error("NXDOMAIN"));
    expect(await public_addresses("public.test.", { resolve })).toEqual(["93.184.216.34"]);
    await expect(public_addresses("mixed.test", { resolve })).rejects.toThrow("mixed.test is not a public address (it leads to 10.0.0.5)");
    await expect(public_addresses("nothing.test", { resolve })).rejects.toThrow("could not be found");
    await expect(public_addresses("gone.test", { resolve })).rejects.toThrow("The host gone.test could not be found.");
    await expect(public_addresses("[::1]", { resolve })).rejects.toThrow("is not a public address");
    await expect(public_addresses("127.0.0.1")).rejects.toThrow("is not a public address");
    await expect(public_addresses("localhost")).rejects.toThrow(/^localhost is not a public address/);
    await expect(public_addresses("")).rejects.toThrow("with its host");
    expect(await public_addresses("127.0.0.1", { allow_address: (address) => address === "127.0.0.1" })).toEqual(["127.0.0.1"]);
    await expect(public_addresses("127.0.0.2", { allow_address: (address) => address === "127.0.0.1" })).rejects.toThrow("is not a public address");
  });
});

describe("guarded_lookup", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((_request, response) => response.end("reached"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  function fetch_text(host: string, options: GuardOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const sent = request({ host, port, path: "/", agent: false, lookup: guarded_lookup(options) }, (response) => {
        let text = "";
        response.on("data", (chunk) => (text += String(chunk)));
        response.on("end", () => resolve(text));
      });
      sent.on("error", reject);
      sent.end();
    });
  }

  it("connects only to the addresses it checked, however the name answers when connecting", async () => {
    const allow_address = (address: string) => address === "127.0.0.1";
    expect(await fetch_text("pages.test", { resolve: async () => ["127.0.0.1"], allow_address })).toBe("reached");
    await expect(fetch_text("inside.test", { resolve: async () => ["192.168.1.5"], allow_address })).rejects.toThrow("inside.test is not a public address");
  });

  it("answers a lookup asking for every address", async () => {
    const lookup = guarded_lookup({ resolve: async () => ["93.184.216.34", "2606:4700:4700::1111"] });
    const found = await new Promise((resolve) => (lookup as unknown as (host: string, options: object, callback: (...args: unknown[]) => void) => void)("public.test", { all: true }, (...args) => resolve(args)));
    expect(found).toEqual([null, [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]]);
  });
});
