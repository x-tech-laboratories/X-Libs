// @vitest-environment jsdom
import "../src/web/react/test_stubs.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import emojis from "emojibase-data/en/data.json" with { type: "json" };
import messages from "emojibase-data/en/messages.json" with { type: "json" };
import type { Emoji as EmojibaseEmoji, MessagesDataset } from "emojibase";

import { EmojiField, picker_data_from } from "../src/web/react/emoji_picker.tsx";

afterEach(cleanup);

// ============================================================================
// Emoji list
// ============================================================================

describe("picker_data_from", () => {
  const data = picker_data_from(emojis as EmojibaseEmoji[], messages as MessagesDataset);

  test("groups the emoji under capitalized names and leaves out the components", () => {
    const labels = data.categories.map((category) => category.label);

    expect(labels[0]).toBe("Smileys & emotion");
    expect(labels).not.toContain("Components");
    expect(data.emojis.some((emoji) => emoji.emoji === "🏻")).toBe(false);
  });

  test("keeps each emoji's search words, skin tones and flag mark", () => {
    const thumbs_up = data.emojis.find((emoji) => emoji.emoji === "👍")!;
    const flag = data.emojis.find((emoji) => emoji.emoji === "🇯🇲")!;

    expect(thumbs_up.label).toBe("Thumbs up");
    expect(thumbs_up.tags).toContain("yes");
    expect(thumbs_up.skins?.dark).toBe("👍🏿");
    expect(flag.countryFlag).toBe(true);
    expect(data.skinTones.light).toBe("Light skin tone");
  });
});

// ============================================================================
// Field
// ============================================================================

describe("EmojiField", () => {
  test("opens the picker with its search ready to type into", () => {
    render(<EmojiField label="Icon" value={null} on_change={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Icon" });

    expect(button.textContent).toBe("Emoji");
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search emoji" }));
  });

  test("shows the chosen emoji and clears it", () => {
    const on_change = vi.fn();
    render(<EmojiField label="Icon" value="🌱" on_change={on_change} />);

    expect(screen.getByRole("button", { name: "Icon: 🌱" }).textContent).toBe("🌱");
    fireEvent.click(screen.getByRole("button", { name: "Clear icon" }));

    expect(on_change).toHaveBeenCalledWith(null);
  });

  test("Enter in the search does not send the form around it", () => {
    render(<form><EmojiField label="Icon" value={null} on_change={vi.fn()} /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Icon" }));

    const search = screen.getByRole("searchbox", { name: "Search emoji" });
    const enter = fireEvent.keyDown(search, { key: "Enter" });

    expect(enter).toBe(false);
  });
});
