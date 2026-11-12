import { describe, expect, it } from "vitest";

import { create_logger, format_record, is_enabled, level_for, parse_level_spec, type LogRecord } from "../src/log.ts";

// ============================================================================
// Settings
// ============================================================================

describe("parse_level_spec", () => {
  it("defaults to info and reads a bare level or its aliases", () => {
    expect(parse_level_spec(undefined)).toEqual({ default: "info", scopes: {} });
    expect(parse_level_spec("debug").default).toBe("debug");
    expect(parse_level_spec("warning").default).toBe("warn");
    expect(parse_level_spec("err").default).toBe("error");
    expect(parse_level_spec("verbose").default).toBe("debug");
  });

  it("sets a level per scope, and * as the default", () => {
    expect(parse_level_spec("warn,play:debug,db:error")).toEqual({ default: "warn", scopes: { play: "debug", db: "error" } });
    expect(parse_level_spec("*:debug").default).toBe("debug");
  });

  it("skips nonsense rather than turning logging off", () => {
    expect(parse_level_spec("nonsense,play:alsononsense,,  ,db:debug")).toEqual({ default: "info", scopes: { db: "debug" } });
  });

  it("reads a nested scope, whose name holds colons of its own", () => {
    const spec = parse_level_spec("info,ui:songlist:debug,play:mpv:error");
    expect(spec.scopes).toEqual({ "ui:songlist": "debug", "play:mpv": "error" });
    expect(is_enabled(spec, "ui:songlist", "debug")).toBe(true);
    expect(is_enabled(spec, "ui:other", "debug")).toBe(false);
  });

  it("ignores case and spaces", () => {
    expect(parse_level_spec("  WARN , Play : DEBUG ").scopes).toEqual({ play: "debug" });
  });
});

describe("dotted scopes", () => {
  it("take the nearest parent's level when they have none of their own", () => {
    const spec = parse_level_spec("warn,app.core:debug,app.core.db:error");
    expect(level_for(spec, "app.core.engine")).toBe("debug");
    expect(level_for(spec, "app.core.db.queries")).toBe("error");
    expect(level_for(spec, "app.web")).toBe("warn");
    expect(level_for(spec, "app.coretwo")).toBe("warn");
  });

  it("leave colon scopes to their own entries", () => {
    const spec = parse_level_spec("info,ui:debug");
    expect(level_for(spec, "ui:other")).toBe("info");
  });
});

describe("levels", () => {
  it("writes levels at or above the one set, and lets one scope be noisier", () => {
    const spec = parse_level_spec("warn");
    expect(is_enabled(spec, "any", "critical")).toBe(true);
    expect(is_enabled(spec, "any", "warn")).toBe(true);
    expect(is_enabled(spec, "any", "info")).toBe(false);

    const mixed = parse_level_spec("error,play:debug");
    expect(is_enabled(mixed, "play", "debug")).toBe(true);
    expect(level_for(mixed, "db")).toBe("error");
  });
});

// ============================================================================
// Loggers
// ============================================================================

describe("create_logger", () => {
  it("hands records to the sink only when their level is on", () => {
    const seen: LogRecord[] = [];
    const log = create_logger("play", parse_level_spec("info"), (record) => seen.push(record));

    log.debug("not written");
    log.info("written", { a: 1 });
    log.error("also written");

    expect(seen.map((record) => record.message)).toEqual(["written", "also written"]);
    expect(seen[0]).toMatchObject({ scope: "play", data: { a: 1 } });
    expect(log.enabled("debug")).toBe(false);
  });

  it("follows a setting that changes after the logger was made", () => {
    const seen: LogRecord[] = [];
    let spec = parse_level_spec("warn");
    const log = create_logger("ui", () => spec, (record) => seen.push(record));

    log.debug("filtered");
    spec = parse_level_spec("debug");
    log.debug("now written");

    expect(seen.map((record) => record.message)).toEqual(["now written"]);
  });

  it("makes child scopes under the parent's", () => {
    const seen: LogRecord[] = [];
    create_logger("play", parse_level_spec("debug"), (record) => seen.push(record)).child("mpv").debug("hello");
    expect(seen[0]!.scope).toBe("play:mpv");
  });
});

describe("format_record", () => {
  it("lays out fixed columns and adds the data as JSON", () => {
    const line = format_record({ at: new Date(2026, 0, 2, 3, 4, 5, 67).getTime(), level: "warn", scope: "play", message: "slow", data: { ms: 12 } });
    expect(line).toContain("03:04:05.067");
    expect(line).toContain("WARN");
    expect(line).toContain("{\"ms\":12}");
  });

  it("survives data that cannot be written as JSON", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(format_record({ at: 0, level: "info", scope: "s", message: "m", data: cyclic })).toContain("[unserializable]");
  });
});
