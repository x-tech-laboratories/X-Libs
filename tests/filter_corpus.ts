// A made-up catalogue of items, with a table of each field kind, filled from a seed so a failure can be repeated.

import { DatabaseSync } from "node:sqlite";

import { integer, sqliteTable, text } from "../src/drizzle.ts";
import { define_catalogue, plain_value, type FilterRecord } from "../src/filter.ts";
import { regexp_matches } from "../src/filter_sql.ts";

// ── Schema ───────────────────────────────────────────────────────────────────

export const items = sqliteTable("items", {
  id: text().primaryKey(),
  title: text(),
  year: integer(),
  rating: integer(),
  added: integer(),
  last_seen: integer(),
  done: integer().notNull(),
  shelf_id: text(),
});

export const files = sqliteTable("files", { id: text().primaryKey(), item_id: text().notNull(), format: text(), size: integer(), quality: integer().notNull() });
export const item_values = sqliteTable("item_values", { item_id: text().notNull(), kind: integer().notNull(), value_id: integer().notNull(), position: integer().notNull() });
export const shared_values = sqliteTable("shared_values", { id: integer().primaryKey(), kind: integer().notNull(), value: text().notNull(), sort_key: text() });

const schema = `
  CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, year INTEGER, rating INTEGER, added INTEGER, last_seen INTEGER, done INTEGER NOT NULL, shelf_id TEXT);
  CREATE TABLE shelves (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE files (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, format TEXT, size INTEGER, quality INTEGER NOT NULL);
  CREATE TABLE shared_values (id INTEGER PRIMARY KEY, kind INTEGER NOT NULL, value TEXT NOT NULL, sort_key TEXT, UNIQUE (kind, value));
  CREATE TABLE item_values (item_id TEXT NOT NULL, kind INTEGER NOT NULL, value_id INTEGER NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE item_tags (item_id TEXT NOT NULL, tag TEXT NOT NULL);
  CREATE TABLE item_notes (item_id TEXT NOT NULL, kind INTEGER NOT NULL, value TEXT);
  CREATE TABLE list_entries (list_id TEXT NOT NULL, item_id TEXT NOT NULL);
`;

// ── Catalogue ────────────────────────────────────────────────────────────────

const genre_kind = 1;
const person_kind = 2;

export const catalogue = define_catalogue({
  table: items,
  fields: {
    title: { kind: "column", column: items.title },
    year: { kind: "column", column: items.year },
    rating: { kind: "column", column: "rating" },
    done: { kind: "column", column: items.done },
    added: { kind: "column", column: items.added },
    last_seen: { kind: "column", column: items.last_seen, clock: "seconds" },
    shelf: { kind: "expression", sql: (row) => `SELECT name FROM shelves WHERE shelves.id = ${row}.shelf_id` },
    comment: { kind: "expression", sql: (row) => `SELECT value FROM item_notes WHERE item_notes.item_id = ${row}.id AND item_notes.kind = 1` },
    format: { kind: "related", table: files, foreign_key: files.item_id, column: files.format, prefer: [{ column: files.quality, descending: true }, { column: files.id }] },
    size: { kind: "related", table: "files", foreign_key: "item_id", column: "size", prefer: [{ column: "quality", descending: true }, { column: "id" }] },
    genre: {
      kind: "set",
      table: item_values,
      row_column: item_values.item_id,
      value_column: item_values.value_id,
      where: { kind: genre_kind },
      order_column: item_values.position,
      values: { table: shared_values, id_column: shared_values.id, value_column: shared_values.value, where: { kind: genre_kind }, sort_column: shared_values.sort_key },
    },
    person: {
      kind: "set",
      table: "item_values",
      row_column: "item_id",
      value_column: "value_id",
      where: { kind: person_kind },
      order_column: "position",
      values: { table: "shared_values", id_column: "id", value_column: "value", where: { kind: person_kind }, sort_column: "sort_key" },
    },
    tag: { kind: "set", table: "item_tags", row_column: "item_id", value_column: "tag" },
    has_files: {
      kind: "custom",
      sql: (node, context) => `EXISTS (SELECT 1 FROM files WHERE files.item_id = ${context.row_id}) = ${context.param(node.value ?? true)}`,
      evaluate: (record, node) => ((record.values.format as unknown[]).length > 0 ? 1 : 0) === plain_value(node.value ?? true),
      order: (row) => `SELECT COUNT(*) FROM files WHERE files.item_id = ${row}.id`,
    },
  },
  operators: {
    in_list: {
      sql: (node, context) => `EXISTS (SELECT 1 FROM list_entries WHERE list_entries.item_id = ${context.row_id} AND list_entries.list_id = ${context.param(node.value)})`,
      evaluate: (record, node) => (record.values.lists as readonly string[]).includes(String(node.value)),
    },
  },
});

// ── Corpus ───────────────────────────────────────────────────────────────────

export const GENRES = ["Rock", "Jazz", "Blues", "Folk", "Électro"];
export const PEOPLE = ["Ada", "The Band", "Zoë", "bob"];
export const TAGS = ["essential", "later"];
export const SHELVES = ["Living room", "Office", "Attic"];
export const FORMATS = ["flac", "MP3", "opus"];
export const LISTS = ["first", "second"];
export const FIXED_NOW = 1_750_000_000_000;

// xorshift32: small and the same on every machine.
export function random_numbers(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export interface Corpus {
  records: FilterRecord[];
  database: DatabaseSync;
}

export function open_corpus(count: number, seed: number): Corpus {
  const random = random_numbers(seed);
  const pick = <Value>(values: readonly Value[]): Value => values[Math.floor(random() * values.length)]!;
  const maybe = <Value>(value: Value, chance_of_null = 0.15): Value | null => (random() < chance_of_null ? null : value);
  const some = <Value>(values: readonly Value[], most: number): Value[] => [...new Set(Array.from({ length: Math.floor(random() * (most + 1)) }, () => pick(values)))];

  const database = new DatabaseSync(":memory:");
  database.function("REGEXP", { deterministic: true }, regexp_matches);
  database.exec(schema);
  SHELVES.forEach((name, index) => database.prepare("INSERT INTO shelves VALUES (?, ?)").run(`shelf-${index}`, name));
  const value_ids = new Map<string, number>();
  for (const [kind, values] of [[genre_kind, GENRES], [person_kind, PEOPLE]] as const) {
    for (const value of values) {
      const id = value_ids.size + 1;
      value_ids.set(`${kind}:${value}`, id);
      database.prepare("INSERT INTO shared_values VALUES (?, ?, ?, ?)").run(id, kind, value, value.startsWith("The ") ? value.slice(4) : null);
    }
  }

  const records: FilterRecord[] = [];
  database.exec("BEGIN");
  for (let index = 1; index <= count; index++) {
    const id = `item-${String(index).padStart(5, "0")}`;
    const shelf = maybe(Math.floor(random() * SHELVES.length), 0.3);
    const row = {
      title: maybe(pick([`Item ${index}`, `item ${index}`, `Été ${index}`, `50%_off ${index}`, ""]), 0.05),
      year: maybe(1950 + Math.floor(random() * 75)),
      rating: random() < 0.3 ? null : Math.floor(random() * 6) * 2,
      added: FIXED_NOW - Math.floor(random() * 900 * 86_400_000),
      last_seen: random() < 0.25 ? null : Math.floor((FIXED_NOW - Math.floor(random() * 400 * 86_400_000)) / 1000),
      done: random() < 0.3 ? 1 : 0,
    };
    database.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, row.title, row.year, row.rating, row.added, row.last_seen, row.done, shelf === null ? null : `shelf-${shelf}`);

    const comment = random() < 0.3 ? `note ${index}` : null;
    if (comment !== null || random() < 0.1) database.prepare("INSERT INTO item_notes VALUES (?, 1, ?)").run(id, comment);

    const item_files = Array.from({ length: random() < 0.1 ? 0 : random() < 0.3 ? 2 : 1 }, (_, number) => ({
      id: `${id}-file-${number}`,
      format: maybe(pick(FORMATS), 0.1),
      size: maybe(1000 + Math.floor(random() * 9000), 0.1),
      quality: Math.floor(random() * 5),
    }));
    for (const file of item_files) database.prepare("INSERT INTO files VALUES (?, ?, ?, ?, ?)").run(file.id, id, file.format, file.size, file.quality);

    const genres = some(GENRES, 2);
    const people = some(PEOPLE, 2);
    genres.forEach((value, position) => database.prepare("INSERT INTO item_values VALUES (?, ?, ?, ?)").run(id, genre_kind, value_ids.get(`${genre_kind}:${value}`)!, position));
    people.forEach((value, position) => database.prepare("INSERT INTO item_values VALUES (?, ?, ?, ?)").run(id, person_kind, value_ids.get(`${person_kind}:${value}`)!, position));
    const tags = some(TAGS, 2);
    for (const tag of tags) database.prepare("INSERT INTO item_tags VALUES (?, ?)").run(id, tag);
    const lists = some(LISTS, 2);
    for (const list of lists) database.prepare("INSERT INTO list_entries VALUES (?, ?)").run(list, id);

    records.push({
      id,
      values: {
        ...row,
        shelf: shelf === null ? null : SHELVES[shelf]!,
        comment,
        format: item_files.map((file) => file.format),
        size: item_files.map((file) => file.size),
        genre: genres,
        person: people,
        tag: tags,
        lists,
      },
    });
  }
  database.exec("COMMIT");
  return { records, database };
}
