// Files as a folder tree on `Tree`: folders first and folding, each changed file with a letter for how it changed and
// its added and removed lines, walked with the arrow keys and picked with Enter or a click, narrowed by a filter box
// that keeps the folders of the files it matches.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from "react";

import type { DiffFileStatus } from "../../diff_rows.ts";
import { Badge } from "./badges.tsx";
import { SearchBox } from "./controls.tsx";
import { DiffCounts, diff_status_words } from "./diff.tsx";
import { Tree, type TreeItem } from "./tree.tsx";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface TreeFile {
  path: string;
  // Missing for a file that did not change.
  status?: DiffFileStatus;
  additions?: number;
  deletions?: number;
}

export interface FileTreeRow<File extends TreeFile = TreeFile> extends TreeItem {
  name: string;
  // Null for a folder.
  file: File | null;
}

const folder_id = (path: string) => `folder:${path}`;

const folder_of = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

const name_of = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// The files and the folders that hold them as tree rows, folders before files and each by name.
export function file_tree_rows<File extends TreeFile>(files: File[]): FileTreeRow<File>[] {
  const rows = new Map<string, FileTreeRow<File>>();
  const add_folder = (path: string): string | null => {
    if (!path) return null;
    const id = folder_id(path);
    if (!rows.has(id)) rows.set(id, { id, parent_id: add_folder(folder_of(path)), position: 0, name: name_of(path), file: null });
    return id;
  };
  for (const file of files) rows.set(`file:${file.path}`, { id: `file:${file.path}`, parent_id: add_folder(folder_of(file.path)), position: 0, name: name_of(file.path), file });
  const sorted = [...rows.values()].sort((first, second) => Number(first.file !== null) - Number(second.file !== null) || first.name.localeCompare(second.name));
  return sorted.map((row, index) => ({ ...row, position: index }));
}

// The folders the files sit in, by path.
export function file_tree_folders(files: Pick<TreeFile, "path">[]): string[] {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/").slice(0, -1);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join("/")));
  }
  return [...folders];
}

// ── View ─────────────────────────────────────────────────────────────────────

interface FileTreeProps<File extends TreeFile> {
  files: File[];
  selected: string | null;
  on_select: (path: string) => void;
  // Anything to show beside a changed file's counts, such as a reviewed mark.
  extra?: (file: File) => ReactNode;
  // Folders that start folded, such as those holding no changed file; none unless given.
  folded?: (folder: string) => boolean;
  label?: string;
  filter_label?: string;
}

export function FileTree<File extends TreeFile>({ files, selected, on_select, extra, folded, label = "Changed files", filter_label = "Filter files" }: FileTreeProps<File>) {
  const [filter, set_filter] = useState("");
  const [collapsed, set_collapsed] = useState<Set<string>>(() => new Set(folded ? file_tree_folders(files).filter(folded).map(folder_id) : []));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files;
  const toggle = (id: string) => set_collapsed((current) => (current.has(id) ? new Set([...current].filter((each) => each !== id)) : new Set([...current, id])));
  return (
    <div className="file-tree">
      <SearchBox label={filter_label} value={filter} on_input={set_filter} />
      {shown.length === 0 ? (
        <p className="diff-note">{files.length ? "No file matches." : "No files."}</p>
      ) : (
        <Tree<FileTreeRow<File>>
          items={file_tree_rows(shown)}
          label={label}
          collapsed={collapsed}
          on_collapsed_change={set_collapsed}
          selected_id={selected ? `file:${selected}` : null}
          on_select={(row) => (row.file ? on_select(row.file.path) : toggle(row.id))}
          name_of={(row) => row.name}
          render_item={(row) => (row.file ? <span className="tree-name">{row.name}</span> : <span>{row.name}/</span>)}
          render_extra={(row) =>
            row.file?.status && (
              <>
                {extra?.(row.file)}
                <DiffCounts additions={row.file.additions ?? 0} deletions={row.file.deletions ?? 0} />
                <Badge tone={diff_status_words[row.file.status][2]} title={diff_status_words[row.file.status][0]}>
                  {diff_status_words[row.file.status][1]}
                </Badge>
              </>
            )
          }
        />
      )}
    </div>
  );
}
