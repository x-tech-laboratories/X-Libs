import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { find_mpv, loadfile_command, MpvEngine, MpvProcess, NullEngine, socket_path_in, type EngineEvents } from "../src/mpv.ts";

// ============================================================================
// A stand-in mpv
// ============================================================================

// Answers mpv's socket as far as the tests need, reading its mode from a file beside it on each start, so one test can
// change it between starts; it notes its pid and every command it is sent.
const stand_in_mpv = `#!${process.execPath}
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const note = (file, line) => fs.appendFileSync(path.join(__dirname, file), line + "\\n");
const mode = fs.readFileSync(path.join(__dirname, "mode"), "utf8").trim();
note("pids", String(process.pid));
note("argv", JSON.stringify(process.argv.slice(2)));
const socket_path = process.argv.find((each) => each.startsWith("--input-ipc-server=")).slice("--input-ipc-server=".length);
if (mode === "exit") { console.error("[ao] no audio device"); process.exit(2); }
if (mode === "silent") setInterval(() => {}, 1000);
else {
  const properties = { pause: false, "idle-active": true, volume: 100, "time-pos": null, duration: null };
  const observers = new Map();
  let connection = null;
  const send = (message) => connection && connection.write(JSON.stringify(message) + "\\n");
  const set = (name, value) => {
    properties[name] = value;
    for (const [id, observed] of observers) if (observed === name) send({ event: "property-change", id, name, data: value });
  };
  const server = net.createServer((socket) => {
    connection = socket;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\\n")) >= 0) {
        const { command, request_id } = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        note("commands", JSON.stringify(command));
        const [name, ...args] = command;
        let reply = { request_id, error: "success", data: null };
        if (name === "observe_property") { observers.set(args[0], args[1]); send(reply); send({ event: "property-change", id: args[0], name: args[1], data: properties[args[1]] }); continue; }
        if (name === "unobserve_property") observers.delete(args[0]);
        else if (name === "get_property") reply = args[0] in properties ? { ...reply, data: properties[args[0]] } : { request_id, error: "property not found" };
        else if (name === "set_property") set(args[0], args[1]);
        else if (name === "loadfile" && args[1] !== "append") { set("idle-active", false); set("duration", 200); set("time-pos", 0); }
        else if (name === "stop") set("idle-active", true);
        else if (name === "x-test-set") { send(reply); set(args[0], args[1]); continue; }
        else if (name === "x-test-send") { send(reply); send(args[0]); continue; }
        else if (name === "x-test-exit") { console.error("[cplayer] gave up"); process.exit(args[0]); }
        else if (name === "quit") { if (mode === "stubborn") continue; send(reply); process.exit(0); }
        send(reply);
      }
    });
  });
  if (mode === "stubborn") process.on("SIGTERM", () => {});
  server.on("error", (error) => { console.error(String(error)); process.exit(3); });
  server.listen(socket_path);
}
`;

type Mode = "serve" | "exit" | "silent" | "stubborn";

let folder: string;
let binary: string;
let opened: { close?: () => Promise<void>; dispose?: () => Promise<void> }[];
const unhandled: unknown[] = [];
const note_unhandled = (reason: unknown) => void unhandled.push(reason);

function set_mode(mode: Mode): void {
  writeFileSync(join(folder, "mode"), mode);
}

function lines_of(file: string): string[] {
  const path = join(folder, file);
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
}

const commands = () => lines_of("commands").map((line) => JSON.parse(line) as unknown[]);
const pids = () => lines_of("pids").map(Number);

function is_alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !condition(); index += 1) await sleep(20);
  expect(condition()).toBe(true);
}

function new_process(options: ConstructorParameters<typeof MpvProcess>[0] = {}): MpvProcess {
  const mpv = new MpvProcess({ binary, ...options });
  opened.push(mpv);
  return mpv;
}

function new_engine(options: ConstructorParameters<typeof MpvEngine>[0] = {}) {
  const engine = new MpvEngine({ binary, position_interval_in_milliseconds: 0, ...options });
  opened.push(engine);
  const states: EngineEvents["state"][] = [];
  const positions: EngineEvents["position"][] = [];
  let ended = 0;
  engine.subscribe((event, payload) => {
    if (event === "state") states.push(payload as EngineEvents["state"]);
    if (event === "position") positions.push(payload as EngineEvents["position"]);
    if (event === "ended") ended += 1;
  });
  return { engine, states, positions, ended: () => ended };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "x-libs-mpv-"));
  binary = join(folder, "mpv");
  writeFileSync(binary, stand_in_mpv);
  chmodSync(binary, 0o755);
  set_mode("serve");
  opened = [];
  unhandled.length = 0;
  process.on("unhandledRejection", note_unhandled);
});

afterEach(async () => {
  for (const each of opened) await (each.close ?? each.dispose)!.call(each);
  process.off("unhandledRejection", note_unhandled);
  vi.unstubAllEnvs();
  for (const pid of pids()) if (is_alive(pid)) process.kill(pid, "SIGKILL");
  rmSync(folder, { recursive: true, force: true });
});

// ============================================================================
// Finding mpv
// ============================================================================

describe("finding mpv", () => {
  function program(name: string, runnable: boolean): string {
    mkdirSync(join(folder, name));
    const path = join(folder, name, "mpv");
    writeFileSync(path, "#!/bin/sh\n");
    chmodSync(path, runnable ? 0o755 : 0o644);
    return path;
  }

  it("takes the first mpv on the PATH that can run", async () => {
    program("broken", false);
    const good = program("good", true);
    vi.stubEnv("PATH", `${join(folder, "broken")}:${join(folder, "good")}`);

    expect(await find_mpv()).toBe(good);
  });

  it("tries each override in turn before the PATH, passing over missing ones", async () => {
    const on_the_path = program("path", true);
    const configured = program("configured", true);
    const explicit = program("explicit", true);
    vi.stubEnv("PATH", join(folder, "path"));

    expect(await find_mpv(explicit, configured)).toBe(explicit);
    expect(await find_mpv(undefined, configured)).toBe(configured);
    expect(await find_mpv(join(folder, "missing", "mpv"), "", null)).toBe(on_the_path);
  });

  it("finds nothing when no mpv can run", async () => {
    program("broken", false);
    vi.stubEnv("PATH", join(folder, "broken"));

    expect(await find_mpv()).toBeNull();
  });
});

// ============================================================================
// The socket's path
// ============================================================================

describe("the socket's path", () => {
  it("stays in the folder asked for while it fits, and moves to /tmp when it would not", () => {
    const long_folder = join("/", "a".repeat(120));

    expect(socket_path_in("/run/user/1000", "x.sock")).toBe("/run/user/1000/x.sock");
    expect(socket_path_in(long_folder, "x.sock")).toBe("/tmp/x.sock");
  });

  it("opens even when the temporary folder has a long path", async () => {
    const long_folder = join(folder, "a-temporary-folder-whose-path-is-far-too-long-for-a-unix-socket-to-live-inside-it");
    mkdirSync(long_folder);
    vi.stubEnv("TMPDIR", long_folder);
    const mpv = new_process({ start_timeout_in_milliseconds: 2000 });

    await mpv.command("stop");

    expect(mpv.socket_path.startsWith("/tmp/")).toBe(true);
    expect(mpv.running).toBe(true);
  });
});

// ============================================================================
// The process
// ============================================================================

describe("the mpv process", () => {
  it("starts on the first command with the app's options and answers it", async () => {
    const mpv = new_process({ args: ["--no-video"], socket_name: "x-test" });
    expect(mpv.running).toBe(false);

    expect(await mpv.get_property("volume")).toBe(100);

    expect(mpv.running).toBe(true);
    expect(mpv.socket_path).toMatch(/x-test-\d+-\d+\.sock$/);
    const argv = JSON.parse(lines_of("argv")[0]!) as string[];
    expect(argv).toEqual(["--idle=yes", "--msg-level=all=warn", `--input-ipc-server=${mpv.socket_path}`, "--no-video"]);
  });

  it("rejects a command mpv refuses with mpv's reason", async () => {
    const mpv = new_process();

    await expect(mpv.get_property("no-such-thing")).rejects.toThrow("mpv refused the command: property not found");
  });

  it("hears an observed property at once, on each change, and again after a restart", async () => {
    const mpv = new_process();
    const volumes: unknown[] = [];
    mpv.observe("volume", (value) => volumes.push(value));

    await mpv.set_property("volume", 40);
    await until(() => volumes.length === 2);
    expect(volumes).toEqual([100, 40]);

    await mpv.command("x-test-exit", 1).catch(() => undefined);
    await until(() => !mpv.running);
    await mpv.command("stop");
    await until(() => volumes.length === 3);
    expect(volumes[2]).toBe(100);
  });

  it("observes a property added while running, and stops when asked", async () => {
    const mpv = new_process();
    await mpv.command("stop");
    const pauses: unknown[] = [];

    const unobserve = mpv.observe("pause", (value) => pauses.push(value));
    await until(() => pauses.length === 1);
    unobserve();
    await mpv.set_property("pause", true);
    await sleep(50);

    expect(pauses).toEqual([false]);
    expect(commands()).toContainEqual(["unobserve_property", 1]);
  });

  it("hands every event to its listeners", async () => {
    const mpv = new_process();
    const events: unknown[] = [];
    mpv.on_event((event) => events.push(event));

    await mpv.command("x-test-send", { event: "file-loaded" });
    await until(() => events.length === 1);

    expect(events).toEqual([{ event: "file-loaded" }]);
  });

  it("says when mpv exits at start, with mpv's last log line, and leaves nothing unhandled", async () => {
    set_mode("exit");
    const mpv = new_process();
    const stops: [string, boolean][] = [];
    mpv.on_stop((reason, clean) => stops.push([reason, clean]));

    await expect(mpv.command("stop")).rejects.toThrow("mpv stopped while starting (exit code 2): [ao] no audio device");

    expect(stops).toEqual([["mpv stopped while starting (exit code 2): [ao] no audio device", false]]);
    await sleep(50);
    expect(unhandled).toEqual([]);
  });

  it("gives up on an mpv that never opens its socket, and stops it", async () => {
    set_mode("silent");
    const mpv = new_process({ start_timeout_in_milliseconds: 300 });

    await expect(mpv.command("stop")).rejects.toThrow("mpv did not answer within 0.3 seconds");

    await until(() => pids().length === 1 && !is_alive(pids()[0]!));
  });

  it("says when mpv cannot be found", async () => {
    vi.stubEnv("PATH", join(folder, "nowhere"));
    const mpv = new MpvProcess({ binary: join(folder, "missing") });

    await expect(mpv.command("stop")).rejects.toThrow(`mpv was not found at ${join(folder, "missing")} or on the PATH`);
  });

  it("starts mpv again on the next command after a failed start", async () => {
    set_mode("exit");
    const mpv = new_process();
    await expect(mpv.command("stop")).rejects.toThrow();

    set_mode("serve");
    await mpv.command("stop");

    expect(mpv.running).toBe(true);
    expect(pids()).toHaveLength(2);
  });

  it("says when a running mpv exits, and starts it again on the next command", async () => {
    const mpv = new_process();
    const stops: [string, boolean][] = [];
    mpv.on_stop((reason, clean) => stops.push([reason, clean]));
    await mpv.command("stop");

    await expect(mpv.command("x-test-exit", 4)).rejects.toThrow("mpv stopped answering");
    await until(() => stops.length === 1);
    expect(stops[0]).toEqual(["mpv stopped (exit code 4): [cplayer] gave up", false]);

    await mpv.command("stop");
    expect(pids()).toHaveLength(2);
  });

  it("closes mpv and waits until it is gone, refusing commands after", async () => {
    const mpv = new_process();
    await mpv.command("stop");
    const [pid] = pids();

    await mpv.close();

    expect(is_alive(pid!)).toBe(false);
    expect(commands().at(-1)).toEqual(["quit"]);
    expect(existsSync(mpv.socket_path)).toBe(false);
    await expect(mpv.command("stop")).rejects.toThrow("mpv was closed");
  });

  it("stops an mpv that will not quit", async () => {
    set_mode("stubborn");
    const mpv = new_process();
    await mpv.command("stop");
    const [pid] = pids();

    await mpv.close();

    expect(is_alive(pid!)).toBe(false);
  }, 10_000);

  it("stops an mpv still starting when closed", async () => {
    set_mode("silent");
    const mpv = new_process();
    const starting = mpv.command("stop");
    await until(() => pids().length === 1);

    await mpv.close();

    await expect(starting).rejects.toThrow();
    expect(is_alive(pids()[0]!)).toBe(false);
  });
});

// ============================================================================
// The engine
// ============================================================================

describe("the mpv engine", () => {
  it("loads a file and plays it, sound only unless asked", async () => {
    const { engine, states } = new_engine();

    await engine.load("/music/song.flac");

    expect(states.map((each) => each.state)).toEqual(["loading", "playing"]);
    expect(commands()).toContainEqual(["loadfile", "/music/song.flac", "replace"]);
    expect(JSON.parse(lines_of("argv")[0]!)).toEqual(expect.arrayContaining(["--no-video", "--audio-display=no", "--gapless-audio=yes"]));
  });

  it("keeps video when asked", async () => {
    const { engine } = new_engine({ video: true });

    await engine.load("/films/film.mkv");

    expect(JSON.parse(lines_of("argv")[0]!)).not.toContain("--no-video");
  });

  it("puts a file's options in loadfile's options, after its index", () => {
    expect(loadfile_command("/a.flac", "append", { start_in_milliseconds: 5000, end_in_milliseconds: 9000, gain_in_decibels: -6, mpv_options: { "sub-file": "/a.srt" } }))
      .toEqual(["loadfile", "/a.flac", "append", -1, "start=5.000,end=9.000,af-add=volume=0.5012,sub-file=/a.srt"]);
    expect(loadfile_command("/a.flac", "replace", {})).toEqual(["loadfile", "/a.flac", "replace"]);
  });

  it("appends the next file for a gapless join", async () => {
    const { engine } = new_engine();

    await engine.load("/music/one.flac");
    await engine.preload("/music/two.flac", { gain_in_decibels: 0 });

    expect(commands()).toContainEqual(["loadfile", "/music/two.flac", "append", -1, "af-add=volume=1.0000"]);
  });

  it("pauses, plays, seeks and sets the volume", async () => {
    const { engine, states } = new_engine();
    await engine.load("/music/song.flac");

    await engine.pause();
    await engine.play();
    await engine.seek(61_500);
    await engine.set_volume(30);

    expect(states.map((each) => each.state).slice(-2)).toEqual(["paused", "playing"]);
    expect(commands()).toEqual(expect.arrayContaining([["seek", 61.5, "absolute"], ["set_property", "volume", 30]]));
  });

  it("follows a pause from mpv itself", async () => {
    const { engine, states } = new_engine();
    await engine.load("/music/song.flac");

    await engine.mpv.command("x-test-set", "pause", true);
    await until(() => states.at(-1)?.state === "paused");
  });

  it("reports the position and the duration", async () => {
    const { engine, positions } = new_engine();
    await engine.load("/music/song.flac");

    await engine.mpv.command("x-test-set", "time-pos", 12.3456);
    await until(() => positions.some((each) => each.position_in_milliseconds === 12_346));

    expect(positions.at(-1)).toEqual({ position_in_milliseconds: 12_346, duration_in_milliseconds: 200_000 });
  });

  it("reports the position at most once per interval", async () => {
    const { engine, positions } = new_engine({ position_interval_in_milliseconds: 60_000 });
    await engine.load("/music/song.flac");
    await until(() => positions.length === 1);

    await engine.mpv.command("x-test-set", "time-pos", 1);
    await engine.mpv.command("x-test-set", "time-pos", 2);
    await sleep(50);

    expect(positions).toHaveLength(1);
  });

  it("says a file ended when mpv goes idle while playing, but not while swapping or stopping", async () => {
    const { engine, states, ended } = new_engine();
    await engine.load("/music/one.flac");
    await engine.load("/music/two.flac");
    await engine.stop();
    expect(ended()).toBe(0);
    expect(states.at(-1)?.state).toBe("idle");

    await engine.load("/music/three.flac");
    await engine.mpv.command("x-test-set", "idle-active", true);
    await until(() => ended() === 1);
    expect(states.at(-1)?.state).toBe("ended");
  });

  it("reports a file mpv cannot play as an error", async () => {
    const { engine, states } = new_engine();
    await engine.load("/music/broken.flac");

    await engine.mpv.command("x-test-send", { event: "end-file", reason: "error", file_error: "unrecognized file format" });
    await until(() => states.at(-1)?.state === "error");

    expect(states.at(-1)).toEqual({ state: "error", error: "unrecognized file format" });
  });

  it("reports an mpv that exits at start as an error state with why, leaving nothing unhandled", async () => {
    set_mode("exit");
    const { engine, states } = new_engine();

    await expect(engine.load("/music/song.flac")).rejects.toThrow(/mpv stopped while starting/);

    expect(states.at(-1)).toEqual({ state: "error", error: "mpv stopped while starting (exit code 2): [ao] no audio device" });
    await sleep(50);
    expect(unhandled).toEqual([]);
  });

  it("plays again through a new mpv after a failed start", async () => {
    set_mode("exit");
    const { engine, states } = new_engine();
    await expect(engine.load("/music/song.flac")).rejects.toThrow();

    set_mode("serve");
    await engine.load("/music/song.flac");

    expect(states.at(-1)).toEqual({ state: "playing" });
  });

  it("goes idle rather than failing when mpv quits cleanly by itself", async () => {
    const { engine, states } = new_engine({ video: true });
    await engine.load("/films/film.mkv");

    await engine.mpv.command("x-test-exit", 0).catch(() => undefined);
    await until(() => states.at(-1)?.state === "idle");
  });

  it("stops before ever starting mpv without starting it", async () => {
    const { engine, states } = new_engine();

    await engine.stop();

    expect(states).toEqual([]);
    expect(pids()).toEqual([]);
  });

  it("leaves no mpv running once disposed", async () => {
    const { engine } = new_engine();
    await engine.load("/music/song.flac");

    await engine.dispose();

    expect(pids().filter(is_alive)).toEqual([]);
  });
});

// ============================================================================
// The engine for tests
// ============================================================================

describe("the null engine", () => {
  it("remembers what it was asked and reports what the test makes happen", async () => {
    const engine = new NullEngine();
    const events: string[] = [];
    engine.subscribe((event, payload) => events.push(event === "state" ? (payload as EngineEvents["state"]).state : event));

    await engine.load("/a.flac");
    await engine.preload("/b.flac");
    await engine.play();
    engine.tick(1000);
    engine.finish();
    engine.fail("gone");

    expect(engine.loaded).toEqual(["/a.flac"]);
    expect(engine.preloaded).toEqual(["/b.flac"]);
    expect(events).toEqual(["loading", "playing", "position", "ended", "error"]);
  });
});

// ============================================================================
// A real mpv
// ============================================================================

const real_mpv = await find_mpv();

describe.runIf(real_mpv)("a real mpv, with no sound", () => {
  it("plays a generated tone to its end and quits when disposed", async () => {
    const engine = new MpvEngine({ binary: real_mpv, args: ["--ao=null"], position_interval_in_milliseconds: 0 });
    const states: string[] = [];
    let ended = false;
    let furthest = 0;
    engine.subscribe((event, payload) => {
      if (event === "state") states.push((payload as EngineEvents["state"]).state);
      if (event === "position") furthest = Math.max(furthest, (payload as EngineEvents["position"]).position_in_milliseconds);
      if (event === "ended") ended = true;
    });
    try {
      await engine.set_volume(0);
      await engine.load("av://lavfi:sine=frequency=440:duration=1", { start_in_milliseconds: 200 });
      for (let index = 0; index < 150 && !ended; index += 1) await sleep(50);

      expect(states).toContain("playing");
      expect(furthest).toBeGreaterThan(200);
      expect(ended).toBe(true);
      expect(await engine.mpv.get_property("idle-active")).toBe(true);
    } finally {
      await engine.dispose();
    }
    expect(engine.mpv.running).toBe(false);
  }, 20_000);
});
