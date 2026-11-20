// @vitest-environment jsdom
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { connection_file_storage } from "../src/connection_file_storage.ts";
import { local_connection_storage } from "../src/web/connection_storage.ts";

const saved = { current: "remote-1", remotes: [{ id: "remote-1", name: "Home", address: "https://home.example", user: "ada", token: "not-a-real-token" }] };

function folder(): string {
  return mkdtempSync(join(tmpdir(), "x-libs-connections-"));
}

describe("connection_file_storage", () => {
  it("reads null while there is no file, then what was written, in a file only its owner can read", () => {
    const file = join(folder(), "profile", "connections.json");
    const storage = connection_file_storage(file);
    expect(storage.read()).toBeNull();

    storage.write(saved);

    expect(storage.read()).toEqual(saved);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(saved);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("tightens a file left readable by others", () => {
    const file = join(folder(), "connections.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);

    connection_file_storage(file).write(saved);

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("local_connection_storage", () => {
  it("reads null while nothing is kept under its key, then what was written", () => {
    const storage = local_connection_storage("x-test-connections");
    localStorage.removeItem("x-test-connections");
    expect(storage.read()).toBeNull();

    storage.write(saved);

    expect(storage.read()).toEqual(saved);
    expect(JSON.parse(localStorage.getItem("x-test-connections")!)).toEqual(saved);
  });
});
