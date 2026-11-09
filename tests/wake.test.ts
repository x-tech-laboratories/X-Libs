import { createSocket } from "node:dgram";
import { describe, expect, it } from "vitest";
import { magic_packet, send_magic_packet } from "../src/agent/wake.ts";

describe("the magic packet", () => {
  it("is six 0xff bytes and the MAC address sixteen times", () => {
    const packet = magic_packet("aa-bb-cc-dd-ee-ff");

    expect(packet.length).toBe(102);
    expect(packet.subarray(0, 6)).toEqual(Buffer.alloc(6, 0xff));
    expect(packet.subarray(96).toString("hex")).toBe("aabbccddeeff");
  });

  it("refuses an address that is not a MAC address", () => {
    expect(() => magic_packet("not-a-mac")).toThrow("'not-a-mac' is not a MAC address");
  });

  it("reaches a listener on the address and port it is sent to", async () => {
    const listener = createSocket("udp4");
    await new Promise<void>((resolve) => listener.bind(0, "127.0.0.1", () => resolve()));
    const received = new Promise<Buffer>((resolve) => listener.once("message", resolve));

    await send_magic_packet({ mac: "aa:bb:cc:dd:ee:ff", broadcast: "127.0.0.1", port: listener.address().port });

    expect(await received).toEqual(magic_packet("aa:bb:cc:dd:ee:ff"));
    listener.close();
  });
});
