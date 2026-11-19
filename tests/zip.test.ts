import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { is_zip, unzip_text_files, zip_text_files } from "../src/zip.ts";

describe("zip", () => {
  it("carries text files through a zip unchanged", () => {
    const files = { "titles.csv": "id,name\r\ntmdb:1,Amélie\r\n", "notes/read me.txt": "✓ done" };
    const bytes = zip_text_files(files);

    expect(is_zip(bytes)).toBe(true);
    expect(unzip_text_files(bytes)).toEqual(files);
  });

  it("leaves folders out", () => {
    const bytes = zipSync({ "tables/": new Uint8Array(), "tables/a.csv": strToU8("a") });
    expect(unzip_text_files(bytes)).toEqual({ "tables/a.csv": "a" });
  });

  it("tells a zip from plain text and refuses to read text as one", () => {
    const text = strToU8("id,name\n");
    expect(is_zip(text)).toBe(false);
    expect(is_zip(new Uint8Array())).toBe(false);
    expect(() => unzip_text_files(text)).toThrow("That file is not a zip.");
  });
});
