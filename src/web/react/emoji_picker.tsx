// An emoji picker on Frimousse, searchable and grouped, with its emoji list bundled so it works offline, and a field that opens it.

import { useRef, useState, type KeyboardEvent } from "react";
import { EmojiPicker as Frimousse, useActiveEmoji, type EmojiData, type SkinTone } from "frimousse";
import type { Emoji as EmojibaseEmoji, MessagesDataset } from "emojibase";
import { Popover } from "./menus.tsx";

// ── Emoji list ───────────────────────────────────────────────────────────────

type Tone = Exclude<SkinTone, "none">;

// Emojibase numbers the skin tones from light to dark.
const tones_by_number: Tone[] = ["light", "medium-light", "medium", "medium-dark", "dark"];

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// Turns Emojibase's emoji and group names into the list the picker shows, leaving out the skin-tone and hair components.
export function picker_data_from(emojis: EmojibaseEmoji[], messages: MessagesDataset): EmojiData {
  const groups = messages.groups.filter((group) => group.key !== "component");
  const flag_subgroup = messages.subgroups.find((subgroup) => subgroup.key === "country-flag");
  const skin_tones = Object.fromEntries(messages.skinTones.map((tone) => [tone.key, capitalized(tone.message)])) as Record<Tone, string>;

  return {
    locale: "en",
    categories: groups.map((group) => ({ index: group.order, label: capitalized(group.message) })),
    skinTones: skin_tones,
    emojis: emojis
      .filter((emoji) => emoji.group !== undefined && groups.some((group) => group.order === emoji.group))
      .map((emoji) => {
        const one_tone_skins = (emoji.skins ?? []).filter((skin) => typeof skin.tone === "number");
        return {
          emoji: emoji.emoji,
          category: emoji.group!,
          version: emoji.version,
          label: capitalized(emoji.label),
          tags: emoji.tags ?? [],
          countryFlag: flag_subgroup !== undefined && emoji.subgroup === flag_subgroup.order ? true : undefined,
          skins: one_tone_skins.length === 0 ? undefined : Object.fromEntries(one_tone_skins.map((skin) => [tones_by_number[(skin.tone as number) - 1], skin.emoji])) as Record<Tone, string>,
        };
      }),
  };
}

let loaded_data: Promise<EmojiData> | null = null;

// Loads the bundled English emoji list once, in its own chunk, so pages that never open the picker skip it.
function load_emoji_data(): Promise<EmojiData> {
  loaded_data ??= Promise.all([
    import("emojibase-data/en/data.json", { with: { type: "json" } }),
    import("emojibase-data/en/messages.json", { with: { type: "json" } }),
  ]).then(([emojis, messages]) => picker_data_from(emojis.default as EmojibaseEmoji[], messages.default as MessagesDataset));
  return loaded_data;
}

// ── Picker ───────────────────────────────────────────────────────────────────

interface EmojiPickerProps {
  on_pick: (emoji: string) => void;
  columns?: number;
}

// A search field over a scrolling grid of emoji under their group names; arrow keys move through it and Enter picks.
export function EmojiPicker({ on_pick, columns = 9 }: EmojiPickerProps) {
  return (
    <Frimousse.Root className="emoji-picker" columns={columns} resolveEmojiData={load_emoji_data} onEmojiSelect={(emoji) => on_pick(emoji.emoji)}>
      <EmojiSearch on_pick={on_pick} />
      <Frimousse.Viewport className="emoji-picker-viewport">
        <Frimousse.Loading className="emoji-picker-note">Loading…</Frimousse.Loading>
        <Frimousse.Empty className="emoji-picker-note">No emoji found.</Frimousse.Empty>
        <Frimousse.List
          className="emoji-picker-list"
          components={{
            CategoryHeader: ({ category, ...props }) => <div className="emoji-picker-group" {...props}>{category.label}</div>,
            Row: ({ children, ...props }) => <div className="emoji-picker-row" {...props}>{children}</div>,
            Emoji: ({ emoji, ...props }) => <button type="button" className="emoji-picker-emoji" title={emoji.label} {...props}>{emoji.emoji}</button>,
          }}
        />
      </Frimousse.Viewport>
    </Frimousse.Root>
  );
}

// Enter is taken here, so a picker inside a form picks the highlighted emoji instead of sending the form.
function EmojiSearch({ on_pick }: { on_pick: (emoji: string) => void }) {
  const active = useActiveEmoji();

  function pick_on_enter(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (active) on_pick(active.emoji);
  }

  return <Frimousse.Search className="emoji-picker-search" aria-label="Search emoji" placeholder="Search emoji" onKeyDown={pick_on_enter} />;
}

// ── Field ────────────────────────────────────────────────────────────────────

interface EmojiFieldProps {
  label: string;
  value: string | null;
  on_change: (emoji: string | null) => void;
  // What the button shows while no emoji is chosen.
  placeholder?: string;
  // Whether a button beside it clears the emoji.
  allow_none?: boolean;
}

// A button showing the chosen emoji that opens the picker under itself, and a button that clears it.
export function EmojiField({ label, value, on_change, placeholder = "Emoji", allow_none = true }: EmojiFieldProps) {
  const [open, set_open] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // The click that closed the popover by landing on its button must not open it again.
  const closed_at = useRef(0);

  function close(): void {
    closed_at.current = Date.now();
    set_open(false);
  }

  function pick(emoji: string): void {
    on_change(emoji);
    close();
  }

  return (
    <div className="emoji-field">
      <button
        ref={trigger}
        type="button"
        className={value ? "emoji-field-button" : "emoji-field-button empty"}
        aria-label={value ? `${label}: ${value}` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { if (Date.now() - closed_at.current > 300) set_open(!open); }}
      >{value ?? placeholder}</button>
      {allow_none && value && <button type="button" className="icon remove" aria-label={`Clear ${label.toLowerCase()}`} title="Clear" onClick={() => on_change(null)}>×</button>}

      {open && (
        <Popover anchor={trigger.current} label={label} on_close={close}>
          <EmojiPicker on_pick={pick} />
        </Popover>
      )}
    </div>
  );
}
