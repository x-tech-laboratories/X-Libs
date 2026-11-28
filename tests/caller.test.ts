import { expect, it } from "vitest";

import { as_caller, caller_of, current_caller } from "../src/caller.ts";

it("runs work as the caller given and brings the one before back, even when the work throws", () => {
  expect(as_caller("program", () => as_caller("engine", current_caller))).toBe("engine");
  expect(() => as_caller("program", () => { throw new Error("stopped"); })).toThrow("stopped");
  expect(current_caller()).toBe("page");
});

it("takes a request with a token for a program and any other for the user at the page", () => {
  expect(caller_of({ viewer: { via: "token" } })).toBe("program");
  expect(caller_of({ viewer: { via: "session" } })).toBe("page");
  expect(caller_of({})).toBe("page");
});
