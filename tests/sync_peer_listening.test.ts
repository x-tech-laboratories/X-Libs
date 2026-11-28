import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SyncPeer } from "../src/sync_peer.ts";
import { keep_listening_for_peers } from "../src/sync_peer_listening.ts";

function setup(listen_fails = false) {
  const file = join(mkdtempSync(join(tmpdir(), "x-libs-listening-")), "profile", "sync-listening.json");
  const closed = vi.fn(async () => {});
  const listen = vi.fn(async ({ port }: { port: number }) => {
    if (listen_fails) throw new Error(`listen EADDRINUSE: address already in use :::${port}`);
    return { close: closed, port, addresses: () => [`http://192.168.1.5:${port}/`] };
  });
  const stopped = vi.fn();
  const discover = vi.fn(() => ({ stop: stopped }));
  const peer = { device: "ME" } as unknown as SyncPeer;
  const certificate = vi.fn(async () => ({ cert: "CERT", key: "KEY", fingerprint: "AB:CD" }));
  const control = keep_listening_for_peers({ peer: () => peer, app: "x-test", file, default_port: 3920, listen: listen as never, discover: discover as never, certificate });
  return { file, control, listen, closed, discover, stopped, certificate };
}

describe("keep_listening_for_peers", () => {
  it("stays off until turned on, looking for paired devices all the same", async () => {
    const { control, listen, discover } = setup();
    await control.start();
    expect(control.methods.get_peer_listening()).toEqual({ on: false, port: 3920, addresses: [], fingerprint: "", error: "" });
    expect(listen).not.toHaveBeenCalled();
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ app: "x-test", port: undefined }));
  });

  it("opens the port when turned on, moves it, and closes it when turned off, keeping the choice", async () => {
    const { file, control, listen, closed, certificate } = setup();
    expect(await control.methods.set_peer_listening(true)).toEqual({ on: true, port: 3920, addresses: ["http://192.168.1.5:3920/"], fingerprint: "AB:CD", error: "" });
    expect(listen).toHaveBeenLastCalledWith(expect.objectContaining({ https: { cert: "CERT", key: "KEY" } }));
    expect(certificate).toHaveBeenCalledWith(join(file, "..", "sync-certificate.json"), "x-test on this computer", expect.any(Array));
    expect(control.addresses()).toEqual(["http://192.168.1.5:3920/"]);
    await control.methods.set_peer_listening(true, 4000);
    expect(listen).toHaveBeenLastCalledWith(expect.objectContaining({ port: 4000 }));
    expect(closed).toHaveBeenCalledTimes(1);

    const later = keep_listening_for_peers({ peer: () => ({}) as SyncPeer, app: "x-test", file, default_port: 3920, listen: listen as never, discover: (() => ({ stop: () => {} })) as never });
    expect(later.methods.get_peer_listening().port).toBe(4000);
    await control.methods.set_peer_listening(false);
    expect(control.addresses()).toEqual([]);
    await control.stop();
  });

  it("reports a port it cannot open, refuses a port out of range, and reads a damaged file as off", async () => {
    const { file, control } = setup(true);
    const state = await control.methods.set_peer_listening(true);
    expect(state.error).toContain("EADDRINUSE");
    await expect(control.methods.set_peer_listening(true, 70000)).rejects.toThrow("1 to 65535");
    writeFileSync(file, "not json");
    expect(control.methods.get_peer_listening()).toMatchObject({ on: false, port: 3920 });
  });
});
