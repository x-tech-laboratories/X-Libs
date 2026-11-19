// Items sorted into groups by a key each one has, such as a status, a year or the collections it is in, for a list or
// grid shown under headings; an item with several keys is in each of their groups.

// ── Groups ───────────────────────────────────────────────────────────────────

export interface ItemGroup<Item> {
  // The key the group's items share, or null for the items that have none.
  key: string | null;
  items: Item[];
}

export interface GroupOptions {
  // Keys that come first in this order, such as statuses in the order they happen; the rest follow by name.
  order?: readonly string[];
  // Puts the keys not in `order` last name first, such as the newest year first.
  descending?: boolean;
}

const by_name = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// The items under each of their keys, each group keeping the items' own order, and the items with no key last.
export function group_items<Item>(
  items: readonly Item[],
  keys_of: (item: Item) => string | readonly string[] | null | undefined,
  { order = [], descending = false }: GroupOptions = {},
): ItemGroup<Item>[] {
  const members = new Map<string, Item[]>();
  const keyless: Item[] = [];
  for (const item of items) {
    const raw_keys = keys_of(item);
    const keys = new Set((typeof raw_keys === "string" ? [raw_keys] : raw_keys ?? []).filter((key) => key !== ""));
    if (keys.size === 0) keyless.push(item);
    for (const key of keys) members.set(key, [...(members.get(key) ?? []), item]);
  }

  const place = new Map(order.map((key, index) => [key, index]));
  const sorted_keys = [...members.keys()].sort((first, second) => {
    const first_place = place.get(first) ?? Infinity;
    const second_place = place.get(second) ?? Infinity;
    if (first_place !== second_place) return first_place - second_place;
    return descending ? by_name.compare(second, first) : by_name.compare(first, second);
  });

  const groups: ItemGroup<Item>[] = sorted_keys.map((key) => ({ key, items: members.get(key)! }));
  if (keyless.length) groups.push({ key: null, items: keyless });
  return groups;
}
