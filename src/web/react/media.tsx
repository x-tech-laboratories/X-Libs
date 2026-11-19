// Pictures with words beside them: avatars, covers, and tiles for videos, albums or playlists laid out in a grid or as rows,
// optionally in groups under headings.

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { Resource } from "./states.tsx";
import { GroupSections } from "./layout.tsx";
import type { ItemGroup } from "../../grouping.ts";

// ── Avatars ──────────────────────────────────────────────────────────────────

interface AvatarProps {
  // The picture, or nothing to show the name's first letter.
  src?: string | null;
  name: string;
  size?: "small" | "medium" | "large";
}

// A round picture of a person or channel, or the first letter of its name when there is none.
export function Avatar({ src, name, size = "medium" }: AvatarProps) {
  const avatar_class = `avatar avatar-${size}`;
  if (src) return <img className={avatar_class} src={src} alt="" loading="lazy" />;
  const first_letter = [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
  return <span className={`${avatar_class} avatar-initial`} aria-hidden="true">{first_letter}</span>;
}

// ── Covers ───────────────────────────────────────────────────────────────────

interface CoverProps {
  // The picture, null when there is none, or undefined while it is still being found.
  src: string | null | undefined;
  // Words for screen readers, left empty for a cover beside the title that already names it.
  alt?: string;
  // Width over height, square unless given.
  aspect?: string;
  // Halon's fixed width of 48, 96 or 160 pixels; the cover fills the width it is given when left out.
  size?: "small" | "medium" | "large";
  // What shows when there is no picture or it fails to load, such as a music note icon.
  placeholder?: ReactNode;
}

// An album's or film's picture, holding its place while it loads and showing the placeholder when there is none.
export function Cover({ src, alt = "", aspect, size, placeholder }: CoverProps) {
  const [broken, set_broken] = useState<string | null>(null);
  const loading = src === undefined;
  const shown = typeof src === "string" && src !== "" && src !== broken;
  const named_blank = !shown && alt !== "";
  return (
    <span
      className={size ? `media-picture cover cover-${size}` : "media-picture cover"}
      style={aspect === undefined ? undefined : { "--media-aspect": aspect } as CSSProperties} aria-busy={loading || undefined}
      role={named_blank ? "img" : undefined} aria-label={named_blank ? alt : undefined}
    >
      {shown
        ? <img src={src} alt={alt} loading="lazy" onError={() => set_broken(src)} />
        : <span className="media-blank" aria-hidden="true">{!loading && placeholder}</span>}
    </span>
  );
}

// A cover's src from the resource that finds it, so a slower earlier answer never replaces a newer one: undefined while it first loads, null when there is none or finding it failed.
export function cover_source(resource: Resource<string | null>): string | null | undefined {
  if (resource.status === "loading") return undefined;
  return resource.status === "loaded" ? resource.data : null;
}

// ── Tiles ────────────────────────────────────────────────────────────────────

interface MediaTileProps {
  title: ReactNode;
  // Where the picture and the title lead.
  href: string;
  image?: string | null;
  // Text over the picture's corner, such as a video's length.
  corner?: ReactNode;
  // The lines under the title, such as the channel and the view count; empty ones are left out.
  lines?: ReactNode[];
  // Fades the tile, such as for one already watched.
  dimmed?: boolean;
  // Buttons in the tile's corner, such as a menu or a remove button.
  actions?: ReactNode;
  // What comes before the picture in a row, such as its place in a playlist.
  lead?: ReactNode;
  // Opens the tile in place, such as in a dialog, on a plain click of the picture or title; the link still opens a new tab.
  on_open?: () => void;
}

// A plain left click, not one asking for a new tab or window.
function is_plain_click(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

// One video, album or playlist: its picture, its title and a few lines about it.
export function MediaTile({ title, href, image, corner, lines = [], dimmed = false, actions, lead, on_open }: MediaTileProps) {
  const shown_lines = lines.filter((line) => line !== null && line !== undefined && line !== false && line !== "");
  const open = on_open
    ? (event: MouseEvent) => {
        if (!is_plain_click(event)) return;
        event.preventDefault();
        on_open();
      }
    : undefined;
  return (
    <div role="listitem" className={dimmed ? "media-tile media-dimmed dimmed" : "media-tile"}>
      {lead !== undefined && <span className="media-lead">{lead}</span>}
      <a className="media-picture" href={href} tabIndex={-1} aria-hidden="true" onClick={open}>
        {image ? <img src={image} alt="" loading="lazy" /> : <span className="media-blank" />}
        {corner && <span className="media-corner">{corner}</span>}
      </a>
      <div className="media-text">
        <a className="media-title" href={href} onClick={open}>{title}</a>
        {shown_lines.map((line, index) => <div key={index} className="media-line">{line}</div>)}
      </div>
      {actions && <div className="media-actions">{actions}</div>}
    </div>
  );
}

// Tiles side by side filling the width, or one under another as rows with the picture on the left.
export function MediaGrid({ label, rows = false, children }: { label?: string; rows?: boolean; children: ReactNode }) {
  return <div role="list" aria-label={label} className={rows ? "media-grid media-rows" : "media-grid"}>{children}</div>;
}

interface GroupedMediaGridProps<Item> {
  groups: ItemGroup<Item>[];
  // A group's heading from its key, null being the items with none.
  name_of: (key: string | null) => string;
  rows?: boolean;
  level?: 2 | 3 | 4;
  // One item's tile, with its key.
  children: (item: Item) => ReactNode;
}

// The groups from `group_items` each under a heading with its count, their tiles in a grid or as rows of their own.
export function GroupedMediaGrid<Item>({ groups, name_of, rows, level, children }: GroupedMediaGridProps<Item>) {
  return (
    <GroupSections groups={groups} name_of={name_of} level={level}>
      {(items, name) => <MediaGrid label={name} rows={rows}>{items.map(children)}</MediaGrid>}
    </GroupSections>
  );
}
