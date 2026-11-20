// A folder of frontmatter files named by id, such as `stage-<id>.md`: every file read with a problem for each that does
// not parse, one written beside its old self and moved over it so a reader never sees half a file, removed, and the
// folder followed for changes made by other programs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse_frontmatter, type FrontmatterFile } from "./frontmatter.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface FrontmatterFolderOptions {
  folder: string;
  // The id a file's name gives, or null for any other file, which is left alone.
  id_of_file: (name: string) => string | null;
  // The file name for an id.
  file_of_id: (id: string) => string;
  // Told when a file changed, here or in another program, once the changes settle.
  on_change?: () => void;
  // How long the folder stays quiet before on_change is told.
  settle_in_milliseconds?: number;
}

export interface FrontmatterProblem {
  // The file's name in the folder.
  file: string;
  problem: string;
}

export interface FrontmatterFolder {
  // Every file the folder names by id, in the order of their names, and why any could not be read.
  read_all: () => { files: Map<string, FrontmatterFile>; problems: FrontmatterProblem[] };
  // The file's whole text, written beside it and moved over it.
  write: (id: string, text: string) => void;
  remove: (id: string) => void;
  // Whether the folder holds a file for the id, readable or not.
  has: (id: string) => boolean;
  path_of: (id: string) => string;
  // Follows the folder for changes made elsewhere; gives back the function that stops.
  watch: () => () => void;
}

// ── Folder ───────────────────────────────────────────────────────────────────

export function create_frontmatter_folder({ folder, id_of_file, file_of_id, on_change = () => undefined, settle_in_milliseconds = 300 }: FrontmatterFolderOptions): FrontmatterFolder {
  const path_of = (id: string): string => join(folder, file_of_id(id));

  return {
    path_of,
    has: (id) => existsSync(path_of(id)),
    read_all: () => {
      const files = new Map<string, FrontmatterFile>();
      const problems: FrontmatterProblem[] = [];
      const names = existsSync(folder) ? readdirSync(folder).sort() : [];
      for (const name of names) {
        const id = id_of_file(name);
        if (id === null) continue;
        try {
          files.set(id, parse_frontmatter(readFileSync(join(folder, name), "utf8")));
        } catch (error) {
          problems.push({ file: name, problem: (error as Error).message });
        }
      }
      return { files, problems };
    },
    write: (id, text) => {
      mkdirSync(folder, { recursive: true });
      const target = path_of(id);
      const temporary = `${target}.saving`;
      writeFileSync(temporary, text);
      renameSync(temporary, target);
    },
    remove: (id) => rmSync(path_of(id), { force: true }),
    watch: () => {
      mkdirSync(folder, { recursive: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watcher = watch(folder, (_event, name) => {
        if (name !== null && id_of_file(String(name)) === null) return;
        clearTimeout(timer);
        timer = setTimeout(on_change, settle_in_milliseconds);
      });
      return () => {
        clearTimeout(timer);
        watcher.close();
      };
    },
  };
}
