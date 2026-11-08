// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { expect, test } from "vitest";

test("a resize observer can watch an element and let it go", () => {
  const observer = new ResizeObserver(() => {});

  expect(() => {
    observer.observe(document.body);
    observer.disconnect();
  }).not.toThrow();
});
