// Several text files carried as one zip, such as an export of a few CSV tables, on fflate, chosen over JSZip because it
// zips and unzips synchronously in a browser, on Node and in a phone's page with no dependencies, at a tenth the size.

// ── Imports ──────────────────────────────────────────────────────────────────

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// ── Zipping ──────────────────────────────────────────────────────────────────

// Each file by its name in the zip, such as "titles.csv", written as UTF-8.
export function zip_text_files(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

// Every file in the zip read as UTF-8 text, by its name; folders are left out.
export function unzip_text_files(bytes: Uint8Array): Record<string, string> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("That file is not a zip.");
  }
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([name]) => !name.endsWith("/"))
      .map(([name, data]) => [name, strFromU8(data)]),
  );
}

// Whether the bytes start as a zip does, to tell a zip from a plain text file picked in its place.
export function is_zip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
