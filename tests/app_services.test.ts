import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { declared_file_of, side_databases } from "../src/app/services.ts";

it("opens each side database once beside the main file, named after it, and closes them all", () => {
  const folder = mkdtempSync(join(tmpdir(), "x-app-sides-"));
  const sides = side_databases(join(folder, "notes.db"));

  const index = sides.open("index");

  expect(sides.open("index")).toBe(index);
  expect(existsSync(join(folder, "notes-index.db"))).toBe(true);
  expect(() => sides.open("../elsewhere")).toThrow("letters, digits");
  sides.close_all();
  expect(() => index.exec("SELECT 1")).toThrow();
});

it("reads declarations from the variable when it is set, even empty, else from the module's file", () => {
  const app = { id: "x-notes", env_prefix: "X_NOTES" };

  expect(declared_file_of(app, {})).toBe("/etc/x-notes/declared.json");
  expect(declared_file_of(app, { X_NOTES_DECLARED_FILE: "/tmp/declared.json" })).toBe("/tmp/declared.json");
  expect(declared_file_of(app, { X_NOTES_DECLARED_FILE: "" })).toBe("");
});
