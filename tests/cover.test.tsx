// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Cover, cover_source } from "../src/web/react/media.tsx";
import { use_resource } from "../src/web/react/states.tsx";

afterEach(cleanup);

const note = <span>♪</span>;

describe("cover", () => {
  it("shows the picture with its words", () => {
    render(<Cover src="https://example.com/cover.jpg" alt="Blue Train" placeholder={note} />);

    expect(screen.getByRole("img", { name: "Blue Train" }).getAttribute("src")).toBe("https://example.com/cover.jpg");
    expect(screen.queryByText("♪")).toBeNull();
  });

  it("holds its place without the placeholder while the picture is found", () => {
    render(<Cover src={undefined} alt="Blue Train" placeholder={note} />);

    const cover = screen.getByRole("img", { name: "Blue Train" });
    expect(cover.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("♪")).toBeNull();
  });

  it("shows the placeholder when there is no picture or it fails to load", () => {
    const { rerender } = render(<Cover src={null} alt="Blue Train" placeholder={note} />);
    expect(screen.getByText("♪")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Blue Train" }).getAttribute("aria-busy")).toBeNull();

    rerender(<Cover src="https://example.com/gone.jpg" alt="Blue Train" placeholder={note} />);
    fireEvent.error(screen.getByRole("img", { name: "Blue Train" }));
    expect(screen.getByText("♪")).toBeTruthy();

    rerender(<Cover src="https://example.com/other.jpg" alt="Blue Train" placeholder={note} />);
    expect(screen.queryByText("♪")).toBeNull();
  });

  it("stays out of the reading order when it has no words", () => {
    render(<Cover src={null} placeholder={note} />);

    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("cover_source", () => {
  // Each album's answer waits until the test settles it.
  const pending = new Map<string, (src: string | null) => void>();
  const find_cover = (album: string) => new Promise<string | null>((resolve) => pending.set(album, resolve));

  function AlbumCover({ album }: { album: string | null }) {
    const art = use_resource(() => find_cover(album!), [album], { enabled: album !== null });
    return <Cover src={cover_source(art)} alt="Album" placeholder={note} />;
  }

  it("keeps a slower earlier answer from replacing the newer album's cover", async () => {
    const { rerender } = render(<AlbumCover album="first" />);
    rerender(<AlbumCover album="second" />);

    await act(async () => pending.get("second")!("https://example.com/second.jpg"));
    await act(async () => pending.get("first")!("https://example.com/first.jpg"));

    expect(screen.getByRole("img", { name: "Album" }).getAttribute("src")).toBe("https://example.com/second.jpg");
  });

  it("is null with no album and while loading undefined", () => {
    const { rerender } = render(<AlbumCover album={null} />);
    expect(screen.getByText("♪")).toBeTruthy();

    rerender(<AlbumCover album="third" />);
    expect(screen.getByRole("img", { name: "Album" }).getAttribute("aria-busy")).toBe("true");
  });
});
