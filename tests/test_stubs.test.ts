// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { expect, test } from "vitest";

test("a resize observer can watch an element and let it go", () => {
  const observer = new ResizeObserver(() => {});

  expect(() => {
    observer.observe(document.body);
    observer.unobserve(document.body);
    observer.disconnect();
  }).not.toThrow();
});

test("a media query says no and takes listeners it never calls", () => {
  const query = window.matchMedia("(max-width: 640px)");
  const listener = (): void => {};

  expect(query.matches).toBe(false);
  expect(query.media).toBe("(max-width: 640px)");
  expect(() => {
    query.addEventListener("change", listener);
    query.removeEventListener("change", listener);
    query.addListener(listener);
    query.removeListener(listener);
    window.scrollTo(0, 0);
  }).not.toThrow();
  expect(query.dispatchEvent(new Event("change"))).toBe(false);
});

test("text and ranges have no boxes", () => {
  const text = document.createTextNode("words");
  document.body.append(text);
  const range = document.createRange();
  range.selectNodeContents(text);

  expect(range.getClientRects()).toHaveLength(0);
  expect(range.getClientRects().item(0)).toBeNull();
  expect(text.getClientRects()).toHaveLength(0);
  expect(range.getBoundingClientRect().width).toBe(0);
});

test("a popover and a modal dialog mark themselves shown and closed", () => {
  const popover = document.createElement("div");
  const dialog = document.createElement("dialog");
  let closed = false;
  popover.addEventListener("toggle", () => (closed = true));

  popover.showPopover();
  expect(popover.hasAttribute("data-shown")).toBe(true);
  popover.hidePopover();
  expect(popover.hasAttribute("data-shown")).toBe(false);
  expect(closed).toBe(true);

  dialog.showModal();
  expect(dialog.open).toBe(true);
  dialog.close();
  expect(dialog.open).toBe(false);
});
