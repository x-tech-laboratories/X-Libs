import { describe, expect, it } from "vitest";

import {
  all_categories,
  category_ancestors,
  category_depth,
  category_leaf,
  drop_from_categories,
  filter_by_category,
  group_by_category,
  is_in_category,
  normalize_categories,
  normalize_category_name,
  rename_in_categories,
} from "../src/categories.ts";

interface Food { name: string; categories: string[] }

const foods: Food[] = [
  { name: "Chicken", categories: ["Protein/Meat/Poultry"] },
  { name: "Beef", categories: ["Protein/Meat"] },
  { name: "Tofu", categories: ["Protein", "Vegan"] },
  { name: "Water", categories: [] },
];
const categories_of = (food: Food) => food.categories;

describe("category names", () => {
  it("trims segments, drops empty ones, and keeps one of those alike ignoring case, parents first", () => {
    expect(normalize_category_name(" Protein / /Meat ")).toBe("Protein/Meat");
    expect(normalize_category_name(3)).toBe("");
    expect(normalize_categories(["b/c", "B/C", "a", " b ", "", 7])).toEqual(["a", "b", "b/c"]);
    expect(normalize_categories("a")).toEqual([]);
  });

  it("reads a path's depth, leaf and parents", () => {
    expect(category_depth("A/B/C")).toBe(2);
    expect(category_leaf("A/B/C")).toBe("C");
    expect(category_ancestors("A/B/C")).toEqual(["A", "A/B"]);
    expect(category_ancestors("A")).toEqual([]);
  });

  it("counts a path as in itself and its parents, not in a sibling sharing its start", () => {
    expect(is_in_category("A/B", "A")).toBe(true);
    expect(is_in_category("A", "A")).toBe(true);
    expect(is_in_category("AB", "A")).toBe(false);
    expect(is_in_category("A", "A/B")).toBe(false);
  });

  it("lists every category named with the parents their paths imply", () => {
    expect(all_categories(["Protein/Meat/Poultry", "Vegan"])).toEqual(["Protein", "Protein/Meat", "Protein/Meat/Poultry", "Vegan"]);
  });
});

describe("renaming and deleting", () => {
  it("moves the subtree with a rename and merges onto a name in use", () => {
    expect(rename_in_categories(["Meat", "Meat/Poultry", "Fish"], "Meat", "Protein/Meat")).toEqual(["Fish", "Protein/Meat", "Protein/Meat/Poultry"]);
    expect(rename_in_categories(["Meat", "Fish", "Fish/Salmon"], "Fish", "Meat")).toEqual(["Meat", "Meat/Salmon"]);
    expect(rename_in_categories(["Meaty", "Meat"], "Meat", "Beef")).toEqual(["Beef", "Meaty"]);
  });

  it("leaves the list as it is for a blank new name", () => {
    expect(rename_in_categories(["b", "a"], "a", " / ")).toEqual(["a", "b"]);
  });

  it("deletes a category with its subtree", () => {
    expect(drop_from_categories(["Meat", "Meat/Poultry", "Meaty"], "Meat")).toEqual(["Meaty"]);
  });
});

describe("items by category", () => {
  it("filters to a category and those below it, or to the items with none", () => {
    expect(filter_by_category(foods, categories_of, "Protein/Meat").map((food) => food.name)).toEqual(["Chicken", "Beef"]);
    expect(filter_by_category(foods, categories_of, null).map((food) => food.name)).toEqual(["Water"]);
  });

  it("groups items under each category they name, keeping parents of filled ones and the uncategorised last", () => {
    const groups = group_by_category(foods, all_categories(foods.flatMap(categories_of)).concat("Empty"), categories_of);

    expect(groups.map((group) => [group.category, group.depth, group.items.map((food) => food.name)])).toEqual([
      ["Protein", 0, ["Tofu"]],
      ["Protein/Meat", 1, ["Beef"]],
      ["Protein/Meat/Poultry", 2, ["Chicken"]],
      ["Vegan", 0, ["Tofu"]],
      [null, 0, ["Water"]],
    ]);
  });
});
