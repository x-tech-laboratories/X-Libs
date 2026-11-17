// Line icons drawn as Halon asks, on a 24px artboard with a 2px round stroke in the text's colour, taken from Lucide so no path is drawn by hand.

import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "../dom.ts";

// ── Icon ─────────────────────────────────────────────────────────────────────

// Any of the glyphs below, or another Lucide icon the app imports itself.
export type IconGlyph = LucideIcon;

export type IconSize = "small" | "large";

interface IconProps {
  icon: IconGlyph;
  // Said by a screen reader; without it the icon is decoration beside words that say the same.
  label?: string;
  // Small for menus, rows, toolbars and close buttons, large for a navigation rail and floating actions.
  size?: IconSize;
  // Turns while work is under way, such as a sync.
  spinning?: boolean;
  className?: string;
}

const large_size: CSSProperties = { width: "var(--icon-size-large)", height: "var(--icon-size-large)" };

export function Icon({ icon: Glyph, label, size = "small", spinning = false, className }: IconProps) {
  const naming = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" as const };
  return (
    <Glyph
      className={cx("line-icon", spinning && "spinning", className)}
      style={size === "large" ? large_size : undefined}
      focusable="false"
      {...naming}
    />
  );
}

// ── Playing media ────────────────────────────────────────────────────────────

export {
  Play as PlayIcon,
  Pause as PauseIcon,
  Square as StopIcon,
  SkipBack as PreviousIcon,
  SkipForward as NextIcon,
  Rewind as RewindIcon,
  FastForward as FastForwardIcon,
  Shuffle as ShuffleIcon,
  Repeat as RepeatIcon,
  Repeat1 as RepeatOneIcon,
  Volume as VolumeOffIcon,
  Volume1 as VolumeLowIcon,
  Volume2 as VolumeHighIcon,
  VolumeX as MuteIcon,
  ListMusic as QueueIcon,
  Music as MusicIcon,
  Disc3 as AlbumIcon,
  Mic as ArtistIcon,
  ListVideo as PlaylistIcon,
} from "lucide-react";

// ── Actions ──────────────────────────────────────────────────────────────────

export {
  Plus as AddIcon,
  Minus as RemoveIcon,
  X as CloseIcon,
  Trash2 as DeleteIcon,
  Pencil as EditIcon,
  Search as SearchIcon,
  Funnel as FilterIcon,
  ArrowDownUp as SortIcon,
  Settings as SettingsIcon,
  RefreshCw as RefreshIcon,
  Undo2 as UndoIcon,
  Redo2 as RedoIcon,
  Copy as CopyIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Save as SaveIcon,
  ExternalLink as ExternalLinkIcon,
  Link as LinkIcon,
  Eye as ShowIcon,
  EyeOff as HideIcon,
  GripVertical as DragIcon,
  LogOut as SignOutIcon,
} from "lucide-react";

// ── Moving around ────────────────────────────────────────────────────────────

export {
  Menu as MenuIcon,
  EllipsisVertical as MoreIcon,
  House as HomeIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronUp as ChevronUpIcon,
  ChevronDown as ChevronDownIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
} from "lucide-react";

// ── States ───────────────────────────────────────────────────────────────────

export {
  Check as CheckIcon,
  TriangleAlert as WarningIcon,
  CircleAlert as ErrorIcon,
  Info as InfoIcon,
  CircleQuestionMark as HelpIcon,
  Star as StarIcon,
  Lock as LockIcon,
  Clock as ClockIcon,
  History as HistoryIcon,
} from "lucide-react";

// ── Things ───────────────────────────────────────────────────────────────────

export {
  Calendar as CalendarIcon,
  Folder as FolderIcon,
  File as FileIcon,
  FileText as NotesIcon,
  Tag as TagIcon,
  User as UserIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  Monitor as SystemThemeIcon,
  Flame as StreakIcon,
} from "lucide-react";
