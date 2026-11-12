import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { IdleInhibitor } from "../../src/agent/inhibit.ts";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const warnings: string[] = [];

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function folder(): string {
  return mkdtempSync(join(tmpdir(), "inhibit-"));
}

// A stand-in systemd-inhibit that skips its four options and runs the command, counting each start.
function fake_inhibit(): [find: () => string, starts: () => number] {
  const where = folder();
  const starts = join(where, "starts");
  const script = join(where, "systemd-inhibit");
  writeFileSync(script, `#!/bin/sh\necho start >> ${starts}\nshift 4\nexec "$@"\n`);
  chmodSync(script, 0o755);
  return [() => script, () => (existsSync(starts) ? readFileSync(starts, "utf8").split("\n").filter(Boolean).length : 0)];
}

describe("the idle inhibitor", () => {
  it("shares one lock among holders and releases it after the linger", async () => {
    const [find, starts] = fake_inhibit();
    const lock = new IdleInhibitor({ who: "test", why: "testing", linger_seconds: 0.05, find });
    await lock.acquire();
    await lock.acquire();
    expect(lock.is_locked).toBe(true);
    lock.release();
    lock.release();
    expect(lock.is_locked).toBe(true);
    await sleep(300);
    expect(lock.is_locked).toBe(false);
    expect(starts()).toBe(1);
  });

  it("starts one lock for concurrent first holds", async () => {
    const [find, starts] = fake_inhibit();
    const lock = new IdleInhibitor({ who: "test", why: "testing", linger_seconds: 0, find });
    await Promise.all(Array.from({ length: 5 }, () => lock.acquire()));
    await until(() => starts() === 1, "the lock to start");
    await lock.close();
    expect(lock.is_locked).toBe(false);
    expect(starts()).toBe(1);
  });

  it("keeps the same lock for a hold within the linger", async () => {
    const [find, starts] = fake_inhibit();
    const lock = new IdleInhibitor({ who: "test", why: "testing", linger_seconds: 0.2, find });
    await lock.held(async () => undefined);
    await lock.held(async () => {
      await sleep(300);
      expect(lock.is_locked).toBe(true);
    });
    await lock.close();
    expect(lock.is_locked).toBe(false);
    await until(() => starts() === 1, "the start count");
  });

  it("does nothing without systemd-inhibit", async () => {
    const lock = new IdleInhibitor({ who: "test", why: "testing", linger_seconds: 0, find: () => null, on_warning: (message) => void warnings.push(message) });
    await lock.held(async () => expect(lock.is_locked).toBe(false));
    await lock.held(async () => undefined);
    expect(warnings).toEqual(["systemd-inhibit is not on PATH, so tasks cannot keep this host awake"]);
  });

  it("names who holds it and why", async () => {
    const where = folder();
    const args = join(where, "args");
    const script = join(where, "systemd-inhibit");
    writeFileSync(script, `#!/bin/sh\necho "$@" > ${args}\nshift 4\nexec "$@"\n`);
    chmodSync(script, 0o755);
    const lock = new IdleInhibitor({ who: "x-test", why: "A task is running", linger_seconds: 0, find: () => script });
    await lock.acquire();
    await until(() => existsSync(args), "the lock to start");
    expect(readFileSync(args, "utf8").trim()).toBe("--what=idle --mode=block --who=x-test --why=A task is running cat");
    await lock.close();
  });
});

