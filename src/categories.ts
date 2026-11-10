// Categories that nest by path: "Protein/Meat/Poultry" is Poultry inside Meat inside Protein, and the path is the
// category's whole identity. Items carry a list of such paths; an item tagged with a path is in each of its parents too
// when filtering, and renaming or deleting a category takes its subtree with it.

// ── Names ────────────────────────────────────────────────────────────────────

export const category_separator = "/";

// Each segment trimmed and empty ones dropped, so " A / /B " is "A/B"; anything not text is "".
export function normalize_category_name(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.split(category_separator).map((segment) => segment.trim()).filter(Boolean).join(category_separator);
}

// A list of paths normalized, the first of those alike ignoring case kept, and sorted, which also puts every parent
// straight before its children.
export function normalize_categories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const by_lower = new Map<string, string>();
  for (const tag of raw) {
    const name = normalize_category_name(tag);
    if (name && !by_lower.has(name.toLowerCase())) by_lower.set(name.toLowerCase(), name);
  }
  return [...by_lower.values()].sort((first, second) => first.localeCompare(second));
}

export function category_depth(name: string): number {
  return name.split(category_separator).length - 1;
}

export function category_leaf(name: string): string {
  return name.split(category_separator).at(-1) ?? name;
}

// "A/B/C" belongs to "A" and "A/B" too.
export function category_ancestors(name: string): string[] {
  const segments = name.split(category_separator);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join(category_separator));
}

// The category itself or one below it.
export function is_in_category(tag: string, category: string): boolean {
  return tag === category || tag.startsWith(`${category}${category_separator}`);
}

// Every category named anywhere, such as kept ones and those on items, with every parent their paths imply.
export function all_categories(named: string[]): string[] {
  return normalize_categories(named.flatMap((name) => [name, ...category_ancestors(name)]));
}

// ── Changes ──────────────────────────────────────────────────────────────────

// Renames a category in a list of paths, moving its subtree with it; a name already in the list merges with it.
export function rename_in_categories(categories: string[], from: string, to: string): string[] {
  const target = normalize_category_name(to);
  if (!target) return normalize_categories(categories);
  return normalize_categories(categories.map((tag) => (is_in_category(tag, from) ? target + tag.slice(from.length) : tag)));
}

// Drops a category and its subtree from a list of paths.
export function drop_from_categories(categories: string[], name: string): string[] {
  return categories.filter((tag) => !is_in_category(tag, name));
}

// ── Items ────────────────────────────────────────────────────────────────────

// The items in a category or any below it; null gives the items with no category.
export function filter_by_category<Item>(items: Item[], categories_of: (item: Item) => string[], category: string | null): Item[] {
  if (category === null) return items.filter((item) => categories_of(item).length === 0);
  return items.filter((item) => categories_of(item).some((tag) => is_in_category(tag, category)));
}

export interface CategoryGroup<Item> {
  // null for the items with no category.
  category: string | null;
  depth: number;
  // Those tagged with this very category, so an item shows under each category it names but not under the parents.
  items: Item[];
}

// One group per category in the order given, kept when it or one below it holds an item so the tree around a filled
// category still shows; the items with no category last, when there are any.
export function group_by_category<Item>(items: Item[], categories: string[], categories_of: (item: Item) => string[]): CategoryGroup<Item>[] {
  const groups: CategoryGroup<Item>[] = categories
    .filter((category) => items.some((item) => categories_of(item).some((tag) => is_in_category(tag, category))))
    .map((category) => ({ category, depth: category_depth(category), items: items.filter((item) => categories_of(item).includes(category)) }));
  const loose = items.filter((item) => categories_of(item).length === 0);
  if (loose.length) groups.push({ category: null, depth: 0, items: loose });
  return groups;
}
