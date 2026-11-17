// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";

import type { LevelSpec, LogRecord } from "../src/log.ts";
import type { PageLogClient } from "../src/log_protocol.ts";
import { create_page_log, type PageLog } from "../src/web/page_log.ts";

let page_log: PageLog | undefined;
afterEach(() => page_log?.stop());

// A client standing in for the bridge, keeping what the page sends.
function client_with(levels: LevelSpec) {
  const sent: LogRecord[] = [];
  const client: PageLogClient = {
    write_log: vi.fn(async (record: LogRecord) => { sent.push(record); }),
    get_log_levels: async () => levels,
  };
  return { client, sent };
}

test("sends records at the main process's levels, which loggers made earlier follow too", async () => {
  const { client, sent } = client_with({ default: "warn", scopes: { player: "debug" } });
  page_log = create_page_log(client);
  const player = page_log.logger("player");
  const library = page_log.logger("library");

  player.debug("before start");
  await page_log.start();
  player.debug("seek", { to: 30 });
  library.info("quiet");
  library.warn("loud");

  expect(sent.map((record) => [record.level, record.scope, record.message])).toEqual([["debug", "player", "seek"], ["warn", "library", "loud"]]);
  expect(sent[0]!.data).toEqual({ to: 30 });
});

test("sends an Error's name, message and stack, and data JSON cannot hold as text", async () => {
  const { client, sent } = client_with({ default: "info", scopes: {} });
  page_log = create_page_log(client, { report_uncaught: false });
  await page_log.start();
  const looped: Record<string, unknown> = {};
  looped.self = looped;

  page_log.logger("app").error("failed", { error: new TypeError("bad") });
  page_log.logger("app").error("looped", looped);

  expect(sent[0]!.data).toMatchObject({ error: { name: "TypeError", message: "bad", stack: expect.any(String) } });
  expect(sent[1]!.data).toBe("[object Object]");
});

test("drops a record the bridge refuses without throwing", async () => {
  const client: PageLogClient = { write_log: async () => { throw new Error("gone"); }, get_log_levels: async () => ({ default: "info", scopes: {} }) };
  page_log = create_page_log(client, { report_uncaught: false });
  await page_log.start();

  expect(() => page_log!.logger("app").info("hello")).not.toThrow();
});

test("reports uncaught errors and rejections until stopped", async () => {
  const { client, sent } = client_with({ default: "info", scopes: {} });
  page_log = create_page_log(client);
  await page_log.start();

  window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 3, colno: 7 }));
  const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
  rejection.reason = new Error("nope");
  window.dispatchEvent(rejection);
  page_log.stop();
  window.dispatchEvent(new ErrorEvent("error", { message: "after stop" }));

  expect(sent.map((record) => [record.level, record.scope, record.message])).toEqual([["error", "uncaught", "boom"], ["error", "uncaught", "unhandled rejection"]]);
  expect(sent[0]!.data).toMatchObject({ source: "app.js", line: 3, column: 7 });
  expect(sent[1]!.data).toMatchObject({ reason: { message: "nope" } });
});
