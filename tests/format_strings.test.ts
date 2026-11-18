import { describe, expect, it } from "vitest";

import { apply_format, compile_format, format_record, format_string, parse_format, template_fields, type FormatValue } from "../src/format_strings.ts";

const song = {
  title: "So What",
  artist: "Miles Davis",
  album_artist: "",
  album: "Kind of Blue",
  year: 1959,
  track: 1,
  disc: null,
  length: 562_000,
  rating: 80,
  genre: ["Jazz", "Modal"],
  path: "/music/miles/kind of blue/01 so what.flac",
};

describe("format strings", () => {
  it("fills in plain fields", () => {
    expect(format_record("{artist} — {title}", song)).toBe("Miles Davis — So What");
  });

  it("takes the first alternative that is not empty", () => {
    expect(format_record("{album_artist|artist}", song)).toBe("Miles Davis");
    expect(format_record("{missing|album_artist}", song)).toBe("");
  });

  it("leaves out a bracketed part when a field in it is empty, and keeps it when all are there", () => {
    expect(format_record("[{disc}.]{track}. {title}", song)).toBe("1. So What");
    expect(format_record("[{year} ]{album}", song)).toBe("1959 Kind of Blue");
    expect(format_record("[{year} [{disc}/]]{album}", song)).toBe("1959 Kind of Blue");
  });

  it("pads numbers with zeros", () => {
    expect(format_record("{track:%02d}", song)).toBe("01");
    expect(format_record("{year:%04d}", song)).toBe("1959");
  });

  it("writes milliseconds as a playing time", () => {
    expect(format_record("{length:m:ss}", song)).toBe("9:22");
    expect(format_record("{length:h:mm:ss}", song)).toBe("0:09:22");
    expect(format_record("{length:m:ss}", { length: 3_725_000 })).toBe("1:02:05");
  });

  it("joins, counts and picks from lists", () => {
    expect(format_record('{genre:join(" / ")}', song)).toBe("Jazz / Modal");
    expect(format_record("{genre}", song)).toBe("Jazz, Modal");
    expect(format_record("{genre:count}", song)).toBe("2");
    expect(format_record("{genre:first}", song)).toBe("Jazz");
  });

  it("takes paths and text apart", () => {
    expect(format_record("{path:basename}", song)).toBe("01 so what.flac");
    expect(format_record("{path:dirname}", song)).toBe("/music/miles/kind of blue");
    expect(format_record("{path:ext}", song)).toBe("flac");
    expect(format_record("{album:upper}|{album:lower}", song)).toBe("KIND OF BLUE|kind of blue");
    expect(format_record("{name:title}", { name: "élan vital o'neil" })).toBe("Élan Vital O'neil");
  });

  it("builds a file name end to end", () => {
    const pattern = "{album_artist|artist}/{year} - {album}/[{disc}.]{track:%02d} - {title}";

    expect(format_record(pattern, song)).toBe("Miles Davis/1959 - Kind of Blue/01 - So What");
  });

  it("takes a character after a backslash as it is", () => {
    expect(format_record("\\{literal\\} \\[x\\]", song)).toBe("{literal} [x]");
  });

  it("runs the app's own formats before the built-in ones", () => {
    const stars = (value: FormatValue): string => "★".repeat(Math.round(Number(value) / 20)).padEnd(5, "☆");
    const pad = (value: FormatValue, width: string | undefined): string => String(value).padStart(Number(width), ".");
    const formats = { stars, pad, upper: (value: FormatValue) => `<${String(value)}>` };

    expect(format_record("{rating:stars}", song, { formats })).toBe("★★★★☆");
    expect(format_record("{track:pad(3)}", song, { formats })).toBe("..1");
    expect(format_record("{title:upper}", song, { formats })).toBe("<So What>");
    expect(format_record("[{disc:stars}]", song, { formats })).toBe("");
  });

  it("reads values from any source", () => {
    const asked: string[] = [];
    const source = (field: string): FormatValue => {
      asked.push(field);
      return field === "name" ? "Ada" : undefined;
    };

    expect(format_string("Hello, {nickname|name}!", source)).toBe("Hello, Ada!");
    expect(asked).toEqual(["nickname", "name"]);
  });

  it("reads a template once to fill it for many items", () => {
    const label = compile_format("{artist}[ ({year})]");

    expect(label((field) => ({ artist: "Nina Simone", year: 1965 })[field])).toBe("Nina Simone (1965)");
    expect(label((field) => ({ artist: "Bill Evans" })[field as "artist"])).toBe("Bill Evans");
  });

  it("formats one value, leaving an empty one empty", () => {
    expect(apply_format(7, "%03d")).toBe("007");
    expect(apply_format(null, "%03d")).toBe("");
    expect(apply_format([], 'join(",")')).toBe("");
  });

  it("runs an unclosed brace or bracket to the end", () => {
    expect(parse_format("a{title")).toEqual([{ kind: "literal", text: "a" }, { kind: "field", fields: ["title"] }]);
    expect(format_record("[{year} x", song)).toBe("1959 x");
  });

  it("names the fields a template needs", () => {
    expect(template_fields("[{disc}.]{track}. {album_artist|artist}").sort()).toEqual(["album_artist", "artist", "disc", "track"]);
  });
});
