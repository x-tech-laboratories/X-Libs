import { expect, test } from "vitest";

test("the test stubs load in a node environment without a window", async () => {
  await expect(import("../src/web/react/test_stubs.ts")).resolves.toBeDefined();
  expect(typeof globalThis.window).toBe("undefined");
});
