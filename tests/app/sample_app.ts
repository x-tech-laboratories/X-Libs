// A small X-app the base app's tests run: notes with a title and a text, their history kept, and one setting of its own.

import { create_history } from "../../src/history.ts";
import type { SqlDatabase } from "../../src/sql.ts";
import { current_caller } from "../../src/caller.ts";
import { define_app, define_feature } from "../../src/app/define.ts";

// ============================================================================
// Notes
// ============================================================================

interface Note {
  id: string;
  title: string;
}

export const note_history = create_history<Note>({
  name: "note",
  item_table: "notes",
  watches: [{ table: "notes", item_columns: ["id"] }],
  read: (database, id) => (database.prepare("SELECT id, title FROM notes WHERE id = ?").get(id) as Note | undefined) ?? null,
  apply: (database, id, note) => void database.prepare("INSERT INTO notes (id, title) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title").run(id, note.title),
});

let next_note = 0;

// How often the notes feature heard the database open and a write finish, for the hooks' tests.
export const notes_hooks = { opened: 0, writes: 0 };

export const notes_feature = define_feature({
  id: "notes",
  migrations: ["CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)"],
  tables: [{ name: "notes", key_columns: ["id"] }],
  methods: {
    list_notes: (database: SqlDatabase): Note[] => database.prepare("SELECT id, title FROM notes ORDER BY title").all() as unknown as Note[],
    add_note: (database: SqlDatabase, title: string): string => {
      const id = `note-${++next_note}`;
      database.prepare("INSERT INTO notes (id, title) VALUES (?, ?)").run(id, title);
      return id;
    },
    rename_note: async (database: SqlDatabase, id: string, title: string): Promise<void> => {
      database.prepare("UPDATE notes SET title = ? WHERE id = ?").run(title, id);
    },
    clear_notes: (database: SqlDatabase): void => void database.prepare("DELETE FROM notes").run(),
    get_note_caller: (_database: SqlDatabase): string => current_caller(),
  },
  api: {
    list_notes: { description: "Every note, by title.", params: [] },
    add_note: { description: "Adds a note and gives its id.", params: [{ name: "title", schema: { type: "string" } }] },
    rename_note: { description: "Renames a note.", params: [{ name: "id", schema: { type: "string" } }, { name: "title", schema: { type: "string" } }] },
    clear_notes: { description: "Removes every note.", params: [], page_only: true },
    get_note_caller: { description: "Who is making this call.", params: [] },
  },
  settings: { "notes.sort": { default: "title" }, "notes.locked": { default: false, user_only: true } },
  histories: [note_history],
  on_open: () => void notes_hooks.opened++,
  after_write: () => void notes_hooks.writes++,
});

// ============================================================================
// App
// ============================================================================

export const sample_app = define_app({
  id: "x-sample",
  name: "X-Sample",
  env_prefix: "X_SAMPLE",
  version: "1.2.3",
  summary: "Serves X-Sample as a web app and syncs its devices.",
  instructions: "X-Sample holds notes.",
  data_name: "notes",
  database_file: "sample.db",
  backup_prefix: "sample",
  ports: { server: 7790, peer: 7791 },
  server_example: "https://notes.example.org",
  features: [notes_feature],
  settings: { currency: { default: "USD" } },
});
