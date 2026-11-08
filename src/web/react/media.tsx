// Pictures with words beside them: avatars, and tiles for videos, albums or playlists laid out in a grid or as rows.

import type { ReactNode } from "react";

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
}

// One video, album or playlist: its picture, its title and a few lines about it.
export function MediaTile({ title, href, image, corner, lines = [], dimmed = false, actions, lead }: MediaTileProps) {
  const shown_lines = lines.filter((line) => line !== null && line !== undefined && line !== false && line !== "");
  return (
    <div role="listitem" className={dimmed ? "media-tile media-dimmed dimmed" : "media-tile"}>
      {lead !== undefined && <span className="media-lead">{lead}</span>}
      <a className="media-picture" href={href} tabIndex={-1} aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" /> : <span className="media-blank" />}
        {corner && <span className="media-corner">{corner}</span>}
      </a>
      <div className="media-text">
        <a className="media-title" href={href}>{title}</a>
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
