import { describe, expect, it } from "vitest";

import { csv_field, csv_records, parse_csv, tsv_records, write_csv, write_csv_records } from "../src/csv.ts";

describe("csv", () => {
  it("reads quoted commas, quotes and line breaks", () => {
    expect(parse_csv('a,b\r\n"one, two","say ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["one, two", 'say "hi"\nthere'],
    ]);
  });

  it("drops a byte-order mark and blank rows, and keeps a last row without a line break", () => {
    expect(parse_csv("﻿a,b\n\n , \n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parse_csv("")).toEqual([]);
  });

  it("reads rows by their header's names, a missing cell as empty", () => {
    expect(csv_records(" Title ,Author\nDune,Herbert\nEmma\n")).toEqual([
      { Title: "Dune", Author: "Herbert" },
      { Title: "Emma", Author: "" },
    ]);
    expect(csv_records("")).toEqual([]);
  });

  it("reads tab-separated text with quotes kept as they are", () => {
    expect(tsv_records('﻿Title\tNote\r\n"Dune"\tsaid "hi"\n\n')).toEqual([{ Title: '"Dune"', Note: 'said "hi"' }]);
    expect(tsv_records("")).toEqual([]);
  });

  it("quotes only the cells that need it, and writes empty for null", () => {
    expect(csv_field("plain")).toBe("plain");
    expect(csv_field('a "b"')).toBe('"a ""b"""');
    expect(csv_field("x,y")).toBe('"x,y"');
    expect(csv_field("x\ny")).toBe('"x\ny"');
    expect(csv_field(null)).toBe("");
    expect(csv_field(undefined)).toBe("");
    expect(csv_field(7.5)).toBe("7.5");
    expect(csv_field(false)).toBe("false");
  });

  it("writes rows that read back the same", () => {
    const text = write_csv(["a", "b"], [["one, two", 'say "hi"\nthere'], [1, null]]);
    expect(text).toBe('a,b\r\n"one, two","say ""hi""\nthere"\r\n1,\r\n');
    expect(parse_csv(text)).toEqual([
      ["a", "b"],
      ["one, two", 'say "hi"\nthere'],
      ["1", ""],
    ]);
  });

  it("writes records under the columns given, leaving out other keys", () => {
    expect(write_csv_records(["id", "name"], [{ name: "Dune", id: "1", extra: "x" }, { id: "2" }])).toBe("id,name\r\n1,Dune\r\n2,\r\n");
  });
});
