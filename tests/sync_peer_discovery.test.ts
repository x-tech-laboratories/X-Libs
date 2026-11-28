import { describe, expect, it, vi } from "vitest";

import { address_of_service, discover_peers } from "../src/sync_peer_discovery.ts";

type OnUp = (service: { txt?: unknown; addresses?: string[]; port: number }) => void;

function fake_bonjour() {
  let on_up: OnUp = () => {};
  const browser = { stop: vi.fn() };
  return {
    publish: vi.fn(),
    find: vi.fn((_options: unknown, listener: OnUp) => ((on_up = listener), browser)),
    destroy: vi.fn(),
    browser,
    announce: (service: Parameters<OnUp>[0]) => on_up(service),
  };
}

describe("sync peer discovery", () => {
  it("announces a listening device and hands on the addresses of the app's other devices", () => {
    const bonjour = fake_bonjour();
    const peer = { device: "ME", found_address: vi.fn() };
    const discovery = discover_peers({ peer, app: "x-tasks", port: 3920, bonjour: bonjour as never });
    expect(bonjour.publish).toHaveBeenCalledWith(expect.objectContaining({ type: "x-sync", port: 3920, txt: { app: "x-tasks", device: "ME" } }));

    bonjour.announce({ txt: { app: "x-tasks", device: "LAPTOP" }, addresses: ["fe80::1", "192.168.1.7"], port: 3920 });
    bonjour.announce({ txt: { app: "x-fitness", device: "OTHER" }, addresses: ["192.168.1.8"], port: 3921 });
    bonjour.announce({ txt: { app: "x-tasks", device: "ME" }, addresses: ["192.168.1.5"], port: 3920 });
    bonjour.announce({ txt: { app: "x-tasks", device: "EMPTY" }, addresses: [], port: 3920 });
    expect(peer.found_address.mock.calls).toEqual([["LAPTOP", "http://192.168.1.7:3920/"]]);

    discovery.stop();
    expect(bonjour.browser.stop).toHaveBeenCalled();
    expect(bonjour.destroy).toHaveBeenCalled();
  });

  it("only looks when the device does not listen, and reaches an IPv6-only device by its routable address", () => {
    const bonjour = fake_bonjour();
    discover_peers({ peer: { device: "ME", found_address: vi.fn() }, app: "x-tasks", bonjour: bonjour as never });
    expect(bonjour.publish).not.toHaveBeenCalled();
    expect(address_of_service({ addresses: ["fe80::1", "fd7a::5"], port: 3920 })).toBe("http://[fd7a::5]:3920/");
  });
});
