import { describe, expect, it } from "vitest";

import { group_items } from "../src/grouping.ts";

interface Film { name: string; status: string; year: string; collections: string[] }

const films: Film[] = [
  { name: "Alien", status: "watched", year: "1979", collections: ["Horror", "Space"] },
  { name: "Heat", status: "planned", year: "1995", collections: [] },
  { name: "Up", status: "watching", year: "2009", collections: ["Space", "Space"] },
  { name: "Jaws", status: "watched", year: "975", collections: [""] },
];

const names_of = (groups: { key: string | null; items: Film[] }[]) => groups.map((group) => [group.key, group.items.map((film) => film.name)]);

describe("group items", () => {
  it("groups by one key in name order, numbers by their value, keeping the items' own order inside a group", () => {
    expect(names_of(group_items(films, (film) => film.year))).toEqual([["975", ["Jaws"]], ["1979", ["Alien"]], ["1995", ["Heat"]], ["2009", ["Up"]]]);
    expect(names_of(group_items(films, (film) => film.status))).toEqual([["planned", ["Heat"]], ["watched", ["Alien", "Jaws"]], ["watching", ["Up"]]]);
  });

  it("puts the listed keys first in their order, and the rest last name first when descending", () => {
    const groups = group_items(films, (film) => film.year, { order: ["1995"], descending: true });

    expect(groups.map((group) => group.key)).toEqual(["1995", "2009", "1979", "975"]);
  });

  it("puts an item with several keys in each group once, and those with none or only empty ones last", () => {
    const groups = group_items(films, (film) => film.collections);

    expect(names_of(groups)).toEqual([["Horror", ["Alien"]], ["Space", ["Alien", "Up"]], [null, ["Heat", "Jaws"]]]);
  });

  it("gives no groups for no items", () => {
    expect(group_items([] as Film[], (film) => film.status)).toEqual([]);
  });
});
