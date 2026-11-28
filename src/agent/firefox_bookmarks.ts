// Firefox's bookmarks on this computer: its default profile found from profiles.ini, and the bookmarks and folders in
// the profile's places.sqlite, read from a copy taken with its write-ahead log, since Firefox keeps the file locked
// while it runs. Tags, which Firefox keeps as folders of their own, are left out.

// ── Imports ──────────────────────────────────────────────────────────────────

import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ── Profile ──────────────────────────────────────────────────────────────────

// Where Firefox keeps its profiles: the XDG folder newer versions use, then the older one.
export function firefox_folders(home = homedir()): string[] {
  return [join(home, ".config", "mozilla", "firefox"), join(home, ".mozilla", "firefox")];
}

// The default profile named in a profiles.ini, as a folder relative to it or absolute.
export function default_profile_of(ini: string): { path: string; is_relative: boolean } | null {
  const sections = ini.split(/^\[/m).map((section) => {
    const [head = "", ...lines] = section.split("\n");
    const values = Object.fromEntries(lines.map((line) => line.split(/=(.*)/s)).filter((pair) => pair.length >= 2).map(([key, value]) => [key!.trim(), value!.trim()]));
    return { head: head.replace(/\].*$/, ""), values };
  });
  const install = sections.find((section) => section.head.startsWith("Install") && section.values.Default);
  if (install) return { path: install.values.Default!, is_relative: true };
  const profiles = sections.filter((section) => section.head.startsWith("Profile") && section.values.Path);
  const chosen = profiles.find((section) => section.values.Default === "1") ?? profiles[0];
  return chosen ? { path: chosen.values.Path!, is_relative: chosen.values.IsRelative !== "0" } : null;
}

// The profile folder set, with ~ as the home folder, or else Firefox's default profile in the folders given.
export async function firefox_profile(set_folder = "", folders = firefox_folders()): Promise<string> {
  const set = set_folder.trim();
  if (set) return resolve(set.replace(/^~(?=$|\/)/, homedir()));
  for (const folder of folders) {
    let ini: string;
    try {
      ini = await readFile(join(folder, "profiles.ini"), "utf8");
    } catch {
      continue;
    }
    const found = default_profile_of(ini);
    if (found) return found.is_relative ? join(folder, found.path) : found.path;
  }
  throw new Error("Firefox's profile was not found.");
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface FirefoxBookmark {
  id: number;
  parent: number;
  // 1 for a bookmark, 2 for a folder.
  type: number;
  title: string | null;
  guid: string;
  url: string | null;
}

// Every bookmark and folder, outside the tags.
export interface FirefoxBookmarks {
  rows: FirefoxBookmark[];
  by_id: Map<number, FirefoxBookmark>;
}

const bookmark_type = 1;
const folder_type = 2;

// Firefox's own root folders, by guid, with the names its window shows.
export const root_names: Record<string, string> = { menu________: "Menu", toolbar_____: "Toolbar", unfiled_____: "Other Bookmarks", mobile______: "Mobile" };

let kept: { key: string; bookmarks: FirefoxBookmarks } | null = null;

// The bookmarks in the profile's places.sqlite; read again only once it or its write-ahead log changes.
export async function read_firefox_bookmarks(profile: string): Promise<FirefoxBookmarks> {
  const places = join(profile, "places.sqlite");
  const sizes = await Promise.all([places, `${places}-wal`].map((path) => stat(path).then((info) => `${info.mtimeMs}:${info.size}`, () => "")));
  if (!sizes[0]) throw new Error(`Firefox's bookmarks were not found in ${profile}.`);
  const key = `${places}|${sizes.join("|")}`;
  if (kept?.key === key) return kept.bookmarks;
  const folder = await mkdtemp(join(tmpdir(), "firefox-bookmarks-"));
  try {
    const copy = join(folder, "places.sqlite");
    await copyFile(places, copy);
    if (sizes[1]) await copyFile(`${places}-wal`, `${copy}-wal`);
    const database = new DatabaseSync(copy);
    try {
      const rows = database
        .prepare("SELECT b.id, b.parent, b.type, b.title, b.guid, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position")
        .all() as unknown as FirefoxBookmark[];
      const tags = rows.find((row) => row.guid === "tags________")?.id;
      const by_id = new Map(rows.map((row) => [row.id, row]));
      const shown = rows.filter((row) => {
        let parent = row.parent;
        for (let step = 0; step < 50 && parent; step++) {
          if (parent === tags) return false;
          parent = by_id.get(parent)?.parent ?? 0;
        }
        return row.id !== tags;
      });
      const bookmarks = { rows: shown, by_id: new Map(shown.map((row) => [row.id, row])) };
      kept = { key, bookmarks };
      return bookmarks;
    } finally {
      database.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

// ── Finding ──────────────────────────────────────────────────────────────────

// A folder's names from its root down, such as "Other Bookmarks/1. Career/5. Job Hunting".
export function bookmark_folder_path(bookmarks: FirefoxBookmarks, id: number): string {
  const names: string[] = [];
  let row = bookmarks.by_id.get(id);
  for (let step = 0; step < 50 && row && row.parent !== 0; step++) {
    names.unshift(root_names[row.guid] ?? (row.title ?? "").trim());
    row = bookmarks.by_id.get(row.parent);
  }
  return names.join("/");
}

// A bookmark of a web page, not a folder, a separator or a saved query.
export function is_page_bookmark(row: FirefoxBookmark): boolean {
  return row.type === bookmark_type && Boolean(row.url) && !row.url!.startsWith("place:");
}

// Bookmarks whose title or address holds every word typed, the first `limit` of them.
export function search_bookmarks(bookmarks: FirefoxBookmarks, query: string, limit = 30): FirefoxBookmark[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return bookmarks.rows.filter((row) => is_page_bookmark(row) && words.every((word) => `${row.title ?? ""} ${row.url}`.toLowerCase().includes(word))).slice(0, limit);
}

// Each bookmark still there, by guid; one deleted is left out.
export function bookmarks_by_guid(bookmarks: FirefoxBookmarks, guids: string[]): Record<string, FirefoxBookmark> {
  const wanted = new Set(guids);
  return Object.fromEntries(bookmarks.rows.filter((row) => is_page_bookmark(row) && wanted.has(row.guid)).map((row) => [row.guid, row]));
}

// Every folder that is not one of Firefox's roots, with its path, in the order of their paths.
export function bookmark_folders(bookmarks: FirefoxBookmarks): { guid: string; path: string }[] {
  return bookmarks.rows
    .filter((row) => row.type === folder_type && row.parent !== 0 && !root_names[row.guid] && bookmarks.by_id.get(row.parent))
    .map((row) => ({ guid: row.guid, path: bookmark_folder_path(bookmarks, row.id) }))
    .sort((first, second) => first.path.localeCompare(second.path, undefined, { numeric: true }));
}

// The bookmarks in a folder and every folder inside it; throws when there is no such folder.
export function bookmarks_in_folder(bookmarks: FirefoxBookmarks, guid: string): FirefoxBookmark[] {
  const folder = bookmarks.rows.find((row) => row.guid === guid && row.type === folder_type);
  if (!folder) throw new Error(`Firefox has no bookmark folder ${guid}.`);
  const inside = new Set([folder.id]);
  // Rows come by parent, so a folder can come before the one holding it; go again until nothing new is found.
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of bookmarks.rows) {
      if (row.type === folder_type && inside.has(row.parent) && !inside.has(row.id)) {
        inside.add(row.id);
        grew = true;
      }
    }
  }
  return bookmarks.rows.filter((row) => is_page_bookmark(row) && inside.has(row.parent));
}
