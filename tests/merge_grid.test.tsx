// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { MergeGrid, merged_values, merge_text, type MergeChoices, type MergeField } from "../src/web/react/merge_grid.tsx";

afterEach(cleanup);

interface Song {
  id: string;
  title: string;
  year: number | null;
  genres: string[];
  files: number;
}

const songs: Song[] = [
  { id: "a", title: "Blue Train", year: 1957, genres: ["Jazz"], files: 1 },
  { id: "b", title: "Blue Train", year: null, genres: ["Hard bop"], files: 2 },
];

const fields: MergeField<Song>[] = [
  { id: "title", label: "Title", value: (song) => song.title },
  { id: "year", label: "Year", value: (song) => song.year },
  { id: "genres", label: "Genres", value: (song) => song.genres, combine: (values) => [...new Set((values as string[][]).flat())] },
];

const key_of = (song: Song) => song.id;

// A grid that keeps its own survivor and choices, as an app would.
function Merging({ only_differences = false, on_merged }: { only_differences?: boolean; on_merged?: (values: Record<string, unknown>) => void }) {
  const [survivor, set_survivor] = useState("a");
  const [choices, set_choices] = useState<MergeChoices>({});
  on_merged?.(merged_values(songs, key_of, fields, survivor, choices));
  return (
    <MergeGrid
      label="Tracks to merge" items={songs} item_key={key_of} item_heading={(_song, index) => `Source ${index + 1}`}
      item_detail={(song) => `${song.files} files`} fields={fields} survivor={survivor} on_survivor_change={set_survivor}
      choices={choices} on_choices_change={set_choices} only_differences={only_differences}
    />
  );
}

const row_of = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!;

// ============================================================================
// Merging rules
// ============================================================================

describe("merged_values", () => {
  it("takes the survivor's value unless a field is picked, and combines where offered by default", () => {
    expect(merged_values(songs, key_of, fields, "a", {})).toEqual({ title: "Blue Train", year: 1957, genres: ["Jazz", "Hard bop"] });
    expect(merged_values(songs, key_of, fields, "b", { genres: { kind: "value", from: "a" } })).toEqual({ title: "Blue Train", year: null, genres: ["Jazz"] });
  });

  it("falls back to the survivor when a choice names a record no longer merged", () => {
    expect(merged_values(songs, key_of, fields, "a", { year: { kind: "value", from: "gone" } }).year).toBe(1957);
  });

  it("reads empty values as nothing and lists joined", () => {
    expect([merge_text(null), merge_text(""), merge_text(["Jazz", null, "Soul"]), merge_text(3)]).toEqual(["", "", "Jazz, Soul", "3"]);
  });
});

// ============================================================================
// Grid
// ============================================================================

describe("merge grid", () => {
  it("lays the records out as columns with their headings, the survivor pressed, and the result last", () => {
    render(<Merging />);

    expect(screen.getByRole("table", { name: "Tracks to merge" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Field", "Source 11 filesSurvivorTake all from this", "Source 22 filesSurvivorTake all from this", "Result",
    ]);
    const survivors = screen.getAllByRole("button", { name: "Survivor" });
    expect(survivors.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  });

  it("offers buttons only where the records disagree and says Empty for a missing value", () => {
    render(<Merging />);

    expect(within(row_of("Title")).queryAllByRole("button")).toEqual([]);
    expect(within(row_of("Year")).getAllByRole("button").map((button) => button.textContent)).toEqual(["1957", "—Empty"]);
  });

  it("picks a value per field, keeps all where offered, and takes every field from one record", () => {
    const merged: Record<string, unknown>[] = [];
    render(<Merging on_merged={(values) => merged.push(values)} />);

    const year = row_of("Year");
    expect(within(year).getByRole("button", { name: "1957" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(year).getByRole("button", { name: "Empty" }));
    expect(within(year).getByRole("button", { name: "Empty" }).getAttribute("aria-pressed")).toBe("true");
    expect(merged.at(-1)!.year).toBeNull();

    const genres = row_of("Genres");
    expect(within(genres).getByRole("button", { name: "Keep all" }).getAttribute("aria-pressed")).toBe("true");
    expect(genres.lastElementChild!.textContent).toContain("Jazz, Hard bop");

    fireEvent.click(screen.getAllByRole("button", { name: "Take all from this" })[0]!);
    expect(merged.at(-1)).toEqual({ title: "Blue Train", year: 1957, genres: ["Jazz"] });
    expect(within(genres).getByRole("button", { name: "Jazz" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getAllByRole("button", { name: "Survivor" })[1]!);
    expect(screen.getAllByRole("button", { name: "Survivor" })[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides the fields that agree when asked", () => {
    render(<Merging only_differences />);

    expect(screen.queryByRole("rowheader", { name: "Title" })).toBeNull();
    expect(screen.getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Year", "Genres"]);
  });

  it("moves between the value buttons with the arrow keys", () => {
    render(<Merging />);
    const year_1957 = within(row_of("Year")).getByRole("button", { name: "1957" });
    year_1957.focus();

    fireEvent.keyDown(year_1957, { key: "ArrowRight" });
    expect(document.activeElement).toBe(within(row_of("Year")).getByRole("button", { name: "Empty" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(row_of("Genres")).getByRole("button", { name: "Hard bop" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(within(row_of("Genres")).getByRole("button", { name: "Keep all" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(within(row_of("Genres")).getByRole("button", { name: "Keep all" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(within(row_of("Genres")).getByRole("button", { name: "Jazz" }));
  });
});
