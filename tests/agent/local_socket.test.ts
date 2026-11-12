import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { follow_lines, LineServer } from "../../src/agent/local_socket.ts";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !condition(); index += 1) await sleep(20);
  expect(condition()).toBe(true);
}

describe("local socket messages", () => {
  it("reach every follower, only the accepted ones, and a follower that comes back", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "local-socket-")), "notify.sock");
    const server = new LineServer(path);
    await server.start();
    expect(statSync(path).mode & 0o777).toBe(0o666);
    const received: Record<string, unknown>[] = [];
    const controller = new AbortController();
    void follow_lines(path, (message) => received.push(message), controller.signal, { accept: (message) => message.type === "notify", retry_seconds: 0.05 });
    try {
      await until(() => server.sockets.size > 0);
      await server.send({ type: "notify", title: "Disk is failed" });
      await server.send({ type: "ping" });
      await until(() => received.length > 0);
      expect(received).toEqual([{ type: "notify", title: "Disk is failed" }]);

      server.close();
      await server.start();
      await until(() => server.sockets.size > 0);
      await server.send({ type: "notify", title: "again" });
      await until(() => received.length > 1);
      expect(received[1]!.title).toBe("again");
    } finally {
      controller.abort();
      server.close();
    }
  });

  it("keep trying while the socket is missing, and stop on abort", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "local-socket-")), "missing.sock");
    const reasons: string[] = [];
    const controller = new AbortController();
    const following = follow_lines(path, () => {}, controller.signal, { retry_seconds: 0.02, on_disconnect: (reason) => void reasons.push(reason) });
    await until(() => reasons.length >= 2);
    controller.abort();
    await following;
  });
});
