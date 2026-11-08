import { expect, test } from "vitest";

import { cx } from "../src/web/dom.ts";

test("joins the class names that are set and skips the rest", () => {
  const hidden = false;
  expect(cx("tile", hidden && "hidden", null, undefined, "tile-good")).toBe("tile tile-good");
  expect(cx()).toBe("");
});
