import { describe, expect, test } from "vitest";

import { describe_error } from "../src/web/errors.ts";

describe("describe_error", () => {
  test("gives an Error's message, or its name when the message is empty", () => {
    expect(describe_error(new Error("disk full"))).toBe("disk full");
    expect(describe_error(new DOMException("", "AbortError"))).toBe("AbortError");
  });

  test("names a shaka-style object by category and code with its string detail", () => {
    expect(describe_error({ severity: 2, category: 1, code: 1002, data: ["https://example.com/seg", 404] })).toBe("Error 1.1002: https://example.com/seg");
    expect(describe_error({ code: 7 })).toBe("Error 7");
  });

  test("takes a plain object's message, a string as it is, and anything else as JSON", () => {
    expect(describe_error({ message: "nope" })).toBe("nope");
    expect(describe_error("just words")).toBe("just words");
    expect(describe_error({ reason: "odd" })).toBe('{"reason":"odd"}');
    expect(describe_error(undefined)).toBe("Unknown error");
  });
});
