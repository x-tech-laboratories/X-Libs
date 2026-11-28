import { describe, expect, it } from "vitest";

import { format_device_id } from "../src/sync_protocol.ts";
import { create_identity, decode_pairing_offer, device_id_of, encode_pairing_offer, from_base64, open_sealed, seal, to_base64 } from "../src/sync_seal.ts";

describe("sync seal", () => {
  it("opens only what the other device sealed for this one, with its bytes, and nothing changed on the way", () => {
    const phone = create_identity();
    const desktop = create_identity();
    const stranger = create_identity();
    const bytes = new Uint8Array(100_000).map((_, at) => at % 251);
    const sealed = seal({ hello: "desktop" }, bytes, desktop.public_key, phone.secret_key);

    const opened = open_sealed(sealed.body, phone.public_key, desktop.secret_key);
    expect(opened?.json).toEqual({ hello: "desktop" });
    expect(opened?.bytes).toEqual(bytes);
    expect(opened?.nonce).toBe(sealed.nonce);
    expect(open_sealed(sealed.body, stranger.public_key, desktop.secret_key)).toBeNull();
    const changed = sealed.body.slice();
    changed[40] = changed[40]! ^ 1;
    expect(open_sealed(changed, phone.public_key, desktop.secret_key)).toBeNull();
    expect(open_sealed(new Uint8Array(3), phone.public_key, desktop.secret_key)).toBeNull();
  });

  it("names a device by its key, shown in groups of eight", () => {
    const device = create_identity();
    expect(device_id_of(device.public_key)).toBe(device.device);
    expect(device.device).toMatch(/^[A-Z2-7]{32}$/);
    expect(format_device_id("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGH-IJKLMNOP");
    expect(from_base64(to_base64(new Uint8Array([0, 255, 7])))).toEqual(new Uint8Array([0, 255, 7]));
  });

  it("reads back a pairing code with spaces a copy added, and refuses a whole code of the wrong shape", () => {
    const device = create_identity();
    const offer = { app: "x-tasks", device: device.device, public_key: device.public_key, name: "Desktop", addresses: ["http://192.168.1.5:3920/"], secret: "c2VjcmV0" };
    const code = encode_pairing_offer(offer);
    expect(decode_pairing_offer(`${code.slice(0, 20)}\n ${code.slice(20)}`)).toEqual(offer);
    const missing_name = encode_pairing_offer({ ...offer, name: undefined as never });
    expect(() => decode_pairing_offer(missing_name)).toThrow("mistyped");
  });
});
