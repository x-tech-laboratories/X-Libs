import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { create_main_log } from "../../src/electron/log.ts";
import type { Level, LogRecord } from "../../src/log.ts";
import { read_page_record } from "../../src/log_protocol.ts";

// A main log whose lines are kept for the test instead of printed.
function capture(setting?: string, file?: string) {
  const lines: { line: string; level: Level }[] = [];
  const log = create_main_log({ setting, file, write_line: (line, level) => lines.push({ line, level }) });
  return { log, lines };
}

const page_record = (fields: Partial<LogRecord>): LogRecord => ({ at: 0, level: "info", scope: "player", message: "hello", ...fields });

describe("create_main_log", () => {
  test("writes the main process's records at the levels its setting gives", () => {
    const { log, lines } = capture("warn,play:debug");

    log.logger("app").info("quiet");
    log.logger("app").warn("loud");
    log.logger("play").debug("detail");

    expect(lines.map((entry) => entry.line.slice(13))).toEqual([
      expect.stringMatching(/^WARN +app +loud$/),
      expect.stringMatching(/^DEBUG +play +detail$/),
    ]);
    expect(lines.map((entry) => entry.level)).toEqual(["warn", "debug"]);
  });

  test("adds every line to the file too", () => {
    const file = join(mkdtempSync(join(tmpdir(), "x-libs-log-")), "app.log");
    const { log } = capture(undefined, file);

    log.logger("app").info("first", { count: 1 });
    log.logger("app").error("second");

    const written = readFileSync(file, "utf8").split("\n");
    expect(written[0]).toMatch(/INFO +app +first \{"count":1\}$/);
    expect(written[1]).toMatch(/ERROR +app +second$/);
    expect(written[2]).toBe("");
  });

  test("carries on when the file cannot be written", () => {
    const { log, lines } = capture(undefined, join(tmpdir(), "no-such-folder-for-x-libs", "app.log"));

    log.logger("app").info("still here");

    expect(lines).toHaveLength(1);
  });

  test("writes the page's records under the page's scope, which a setting turns up as one", () => {
    const { log, lines } = capture("page:debug");

    log.methods.write_log(page_record({ level: "debug", scope: "player", message: "seek", at: Date.UTC(2026, 0, 1) }));
    log.methods.write_log(page_record({ level: "debug", scope: "", message: "boot" }));

    expect(lines.map((entry) => entry.line.slice(13))).toEqual([
      expect.stringMatching(/^DEBUG +page\.player +seek$/),
      expect.stringMatching(/^DEBUG +page +boot$/),
    ]);
  });

  test("drops page records below the level and ones that are not records", () => {
    const { log, lines } = capture("warn");

    log.methods.write_log(page_record({ level: "info" }));
    log.methods.write_log({ level: "shout", scope: "x", message: "y" } as unknown as LogRecord);
    log.methods.write_log(null as unknown as LogRecord);

    expect(lines).toHaveLength(0);
  });

  test("hands the page its levels and describes the setting", () => {
    const { log } = capture("warn,play:debug", "/tmp/app.log");

    expect(log.methods.get_log_levels()).toEqual({ default: "warn", scopes: { play: "debug" } });
    expect(log.describe()).toBe("level=warn play=debug file=/tmp/app.log");
  });
});

describe("read_page_record", () => {
  test("keeps a well-formed record and stamps one without a time", () => {
    expect(read_page_record({ at: 5, level: "warn", scope: "a", message: "b", data: { c: 1 } })).toEqual({ at: 5, level: "warn", scope: "a", message: "b", data: { c: 1 } });
    expect(read_page_record({ level: "info", scope: "a", message: "b" })?.at).toBeTypeOf("number");
    expect(read_page_record({ level: "info", scope: 1, message: "b" })).toBeNull();
    expect(read_page_record("info")).toBeNull();
  });
});
