// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardGrid, place_cards, step_card, step_of_key, type CardPlace } from "../src/web/react/card_grid.tsx";

afterEach(cleanup);

const size = { w: 4, h: 3 };
const min = { w: 2, h: 2 };

// ============================================================================
// Placing
// ============================================================================

describe("place_cards", () => {
  it("adds cards without a place in rows below the saved ones, and floats every card up into the gaps", () => {
    const saved: CardPlace[] = [{ id: "a", x: 0, y: 5, w: 6, h: 2 }];
    expect(place_cards(["a", "b", "c", "d", "e"], saved, 12, size)).toEqual([
      { id: "a", x: 0, y: 0, w: 6, h: 2 },
      { id: "d", x: 8, y: 0, w: 4, h: 3 },
      { id: "b", x: 0, y: 2, w: 4, h: 3 },
      { id: "c", x: 4, y: 2, w: 4, h: 3 },
      { id: "e", x: 0, y: 5, w: 4, h: 3 },
    ]);
  });

  it("drops places of cards no longer given and keeps a saved card within the columns", () => {
    const saved: CardPlace[] = [
      { id: "gone", x: 0, y: 0, w: 4, h: 4 },
      { id: "wide", x: 10, y: 0, w: 20, h: 1.6 },
    ];
    expect(place_cards(["wide"], saved, 12, size)).toEqual([{ id: "wide", x: 0, y: 0, w: 12, h: 2 }]);
  });
});

// ============================================================================
// Keyboard
// ============================================================================

describe("step_card", () => {
  const two_side_by_side: CardPlace[] = [
    { id: "a", x: 0, y: 0, w: 4, h: 3 },
    { id: "b", x: 4, y: 0, w: 4, h: 3 },
  ];

  it("moves a card across, never off the grid", () => {
    expect(step_card(two_side_by_side, "b", { x: 1 }, 12, min).find((place) => place.id === "b")).toMatchObject({ x: 5, y: 0 });
    expect(step_card(two_side_by_side, "a", { x: -1 }, 12, min).find((place) => place.id === "a")).toMatchObject({ x: 0 });
    expect(step_card([{ id: "a", x: 8, y: 0, w: 4, h: 3 }], "a", { x: 1 }, 12, min)[0]).toMatchObject({ x: 8 });
  });

  it("moves a card down past the one below it, and back up above it", () => {
    const stacked: CardPlace[] = [
      { id: "a", x: 0, y: 0, w: 4, h: 3 },
      { id: "b", x: 0, y: 3, w: 4, h: 3 },
    ];
    const down = step_card(stacked, "a", { y: 1 }, 12, min);
    expect(down.map((place) => place.id)).toEqual(["b", "a"]);
    const up = step_card(down, "a", { y: -1 }, 12, min);
    expect(up.map((place) => place.id)).toEqual(["a", "b"]);
  });

  it("grows and shrinks a card within the columns and its smallest size", () => {
    expect(step_card(two_side_by_side, "a", { w: 1 }, 12, min).find((place) => place.id === "a")).toMatchObject({ w: 5 });
    expect(step_card(two_side_by_side, "a", { h: -5 }, 12, min).find((place) => place.id === "a")).toMatchObject({ h: 2 });
    expect(step_card([{ id: "a", x: 8, y: 0, w: 4, h: 3 }], "a", { w: 3 }, 12, min)[0]).toMatchObject({ w: 4 });
  });

  it("reads the arrow keys as moves, and with Shift as resizes", () => {
    expect(step_of_key("ArrowRight", false)).toEqual({ x: 1, y: 0 });
    expect(step_of_key("ArrowUp", true)).toEqual({ w: 0, h: -1 });
    expect(step_of_key("Enter", false)).toBeNull();
  });
});

// ============================================================================
// Grid
// ============================================================================

interface Note {
  id: string;
  title: string;
}

const notes: Note[] = [
  { id: "a", title: "Plan" },
  { id: "b", title: "Budget" },
];

function Grid({ on_change, editable = true }: { on_change: (places: CardPlace[]) => void; editable?: boolean }) {
  const [places, set_places] = useState<CardPlace[]>([]);
  return (
    <CardGrid
      items={notes}
      id_of={(note) => note.id}
      name_of={(note) => note.title}
      render_card={(note) => <p>{note.title}</p>}
      label="Notes"
      places={places}
      on_places_change={(next) => {
        set_places(next);
        on_change(next);
      }}
      default_size={size}
      editable={editable}
      width={1200}
    />
  );
}

describe("CardGrid", () => {
  it("shows each card with a handle named for it, and moves one with the arrow keys", () => {
    const on_change = vi.fn();
    render(<Grid on_change={on_change} />);

    const grid = screen.getByRole("list", { name: "Notes" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
    expect(within(grid).getByText("Budget")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Budget" }), { key: "ArrowRight" });
    expect(on_change).toHaveBeenLastCalledWith(expect.arrayContaining([{ id: "b", x: 5, y: 0, w: 4, h: 3 }]));

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Plan" }), { key: "ArrowDown", shiftKey: true });
    expect(on_change).toHaveBeenLastCalledWith(expect.arrayContaining([{ id: "a", x: 0, y: 0, w: 4, h: 4 }]));

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Plan" }), { key: "Tab" });
    expect(on_change).toHaveBeenCalledTimes(2);
  });

  it("shows no handles when the cards are not to be arranged", () => {
    render(<Grid on_change={vi.fn()} editable={false} />);
    expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
  });

  it("lists the cards in a column on a phone, in reading order", () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      render(<Grid on_change={vi.fn()} />);
      const grid = screen.getByRole("list", { name: "Notes" });
      expect(within(grid).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Plan", "Budget"]);
      expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
    } finally {
      window.matchMedia = before;
    }
  });
});
