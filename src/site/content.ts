// Reads a site's content folder: every Markdown and MDX file with its frontmatter, placed in its locale.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parse_yaml } from "yaml";
import { place_of_file, type Frontmatter, type SourcePage } from "./model.ts";

// The YAML between the opening and closing --- lines, or nothing when the file has none.
export function read_frontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return {};
  const parsed: unknown = parse_yaml(match[1]);
  return parsed !== null && typeof parsed === "object" ? (parsed as Frontmatter) : {};
}

// Folders that never hold pages, so a site can keep its package, build and public files beside its pages.
const skipped_folders = new Set(["node_modules", "dist", "public"]);

function is_skipped(name: string): boolean {
  return skipped_folders.has(name) || name.startsWith(".") || name.startsWith("_");
}

// The text of the page's opening "# heading", after any frontmatter and imports, with its inline code marks dropped.
export function title_heading(text: string): string | undefined {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "" || /^(import|export) /.test(line)) continue;
    const heading = /^# +(.+?)\s*#*\s*$/.exec(line);
    return heading ? heading[1].replace(/`/g, "") : undefined;
  }
  return undefined;
}

// Every .md and .mdx file under the folder, as paths with forward slashes, in a steady order, never looking inside
// node_modules, dist, public or hidden folders.
export function list_content_files(folder: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(folder, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory() && !is_skipped(entry.name)) files.push(...list_content_files(folder, path));
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

// When git last changed each file, by path; empty outside a git checkout.
function last_commit_dates(folder: string): Map<string, string> {
  const dates = new Map<string, string>();
  try {
    const log = execFileSync("git", ["log", "--format=%x00%cI", "--name-only", "--relative", "--", "."], { cwd: folder, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let date = "";
    for (const line of log.split("\n")) {
      if (line.startsWith("\0")) date = line.slice(1);
      else if (line !== "" && !dates.has(line)) dates.set(line, date);
    }
  } catch {
    // Not a git checkout, or git is missing: no dates.
  }
  return dates;
}

export function read_content(folder: string, locale_keys: readonly string[], with_dates = false): SourcePage[] {
  const dates = with_dates ? last_commit_dates(folder) : new Map<string, string>();
  return list_content_files(folder).map((id) => {
    const text = readFileSync(join(folder, id), "utf8");
    const frontmatter = read_frontmatter(text);
    frontmatter.title ??= title_heading(text);
    if (typeof frontmatter.title !== "string") throw new Error(`${id} has no title in its frontmatter or a # heading.`);
    return { id, ...place_of_file(id, locale_keys), frontmatter, last_updated: dates.get(id) };
  });
}
