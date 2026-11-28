import { expect, it } from "vitest";

import { app_link, route_of_link } from "../src/app/links.ts";

it("makes a page's link in the app's scheme and reads the route back", () => {
  expect(app_link("x-notes", "#/note/n1")).toBe("x-notes://note/n1");
  expect(route_of_link("x-notes", "x-notes://note/n1/")).toBe("#/note/n1");
  expect(route_of_link("x-notes", "X-NOTES://inbox")).toBe("#/inbox");
});

it("takes no other scheme's link, and nothing that is not a plain path", () => {
  expect(route_of_link("x-notes", "https://example.org")).toBeNull();
  expect(route_of_link("x-notes", "--hidden")).toBeNull();
  expect(route_of_link("x-notes", "x-notes://note/<script>")).toBeNull();
});
