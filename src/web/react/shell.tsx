// The frame around every view: the top bar, the sidebar that slides in on phones and resizes on wide screens, its foot
// pinned with the theme, the signed-in user and Settings, a status bar, and the toasts, dialogs and menus.

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { current_route, type Route } from "../router.ts";
import { store_sizes, stored_sizes } from "../split.ts";
import { is_boolean } from "../prefs.ts";
import { next_theme, type Theme, type ThemeChoice } from "../theme.ts";
import { Dialogs } from "./dialog.tsx";
import { Icon, type IconGlyph } from "./icons.tsx";
import { ContextMenus } from "./menus.tsx";
import { use_media_query } from "./phone.ts";
import { use_pref } from "./prefs.ts";
import { ResizeHandle } from "./split.tsx";
import { Toasts } from "./toasts.tsx";
import { Tree } from "./tree.tsx";

// ── Route ────────────────────────────────────────────────────────────────────

// The hash route, read again whenever it changes.
export function use_route(): Route {
  const [route, set_route] = useState(current_route);
  useEffect(() => {
    const changed = () => set_route(current_route());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}

// ── Theme ────────────────────────────────────────────────────────────────────

const theme_labels: Record<Theme, [icon: string, text: string]> = { system: ["◐", "Theme: system"], light: ["☀", "Theme: light"], dark: ["☾", "Theme: dark"] };

// Steps through system, light and dark, its glyph and label showing the current one.
export function ThemeButton({ choice }: { choice: ThemeChoice }) {
  const [theme, set_theme] = useState(choice.get);
  useEffect(() => choice.on_change(set_theme), []);
  const [icon, text] = theme_labels[use_is_hydrated() ? theme : "system"];
  return (
    <button id="theme" className="icon" title={`${text} (click to change)`} aria-label={`${text}, click to change`} onClick={() => choice.set(next_theme(choice.get()))}>
      {icon}
    </button>
  );
}

// ── Words ────────────────────────────────────────────────────────────────────

// The words the Shell shows, for a page in another language.
export interface ShellLabels {
  skip_to_content: string;
  open_menu: string;
  // The sidebar's name for screen readers.
  main_navigation: string;
  resize_sidebar: string;
  sign_out: string;
  settings: string;
  theme_names: Record<Theme, string>;
  change_theme: string;
  // The side pane's close button and grab bar, each given the pane's title; "Close <title>" and "Resize <title>" unless set.
  close_side_pane?: (title: string) => string;
  resize_side_pane?: (title: string) => string;
}

export const shell_labels: ShellLabels = {
  skip_to_content: "Skip to content",
  open_menu: "Open the menu",
  main_navigation: "Main",
  resize_sidebar: "Resize the sidebar",
  sign_out: "Sign out",
  settings: "Settings",
  theme_names: { system: "System theme", light: "Light theme", dark: "Dark theme" },
  change_theme: "Click to change the theme",
  close_side_pane: (title) => `Close ${title}`,
  resize_side_pane: (title) => `Resize ${title}`,
};

// False while a page drawn on the server is being picked up in the browser, so the first draw matches the server's.
function use_is_hydrated(): boolean {
  return useSyncExternalStore(never_changes, () => true, () => false);
}

function never_changes(): () => void {
  return () => undefined;
}

// The theme as a sidebar row, its icon and name showing the current one, stepping to the next on each click.
export function ThemeRow({ choice, labels = shell_labels }: { choice: ThemeChoice; labels?: Pick<ShellLabels, "theme_names" | "change_theme"> }) {
  const [theme, set_theme] = useState(choice.get);
  useEffect(() => choice.on_change(set_theme), []);
  // The server cannot know the reader's choice, so it draws the system theme, as does the browser's first draw.
  const shown = use_is_hydrated() ? theme : "system";
  return (
    <button className="tree-row" title={labels.change_theme} onClick={() => choice.set(next_theme(choice.get()))}>
      <span className="tree-label"><ThemeIcon theme={shown} /><span>{labels.theme_names[shown]}</span></span>
    </button>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true">
      {theme === "light" && <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </>}
      {theme === "dark" && <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />}
      {theme === "system" && <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </>}
    </svg>
  );
}

// ── Sidebar foot ─────────────────────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// A sidebar row that links somewhere, raised while you are there.
function RowLink({ href, current, icon, label, on_open }: { href: string; current: boolean; icon: ReactNode; label: string; on_open?: () => void }) {
  return (
    <a
      href={href}
      className={current ? "tree-row active" : "tree-row"}
      aria-current={current ? "page" : undefined}
      onClick={on_open && ((event) => {
        event.preventDefault();
        on_open();
      })}
    >
      <span className="tree-label">{icon}<span>{label}</span></span>
    </a>
  );
}

// The brand: its full logo when it has one, named for screen readers, else its icon before its name.
function BrandMark({ brand, icon, logo }: { brand: string; icon?: string; logo?: string }) {
  if (logo) return <img className="brand-logo" src={logo} alt={brand} />;
  return <>{icon && <img className="brand-icon" src={icon} alt="" />}{brand}</>;
}

// ── Section tree ─────────────────────────────────────────────────────────────

// A section's row has the id "section:<id>"; an item's row names its section as parent and has the id "<section>/<id>".
interface SectionRow {
  id: string;
  parent_id: string | null;
  position: number;
  label: string;
  href: string;
}

const section_row_id = (section: string) => `section:${section}`;

function section_rows(sections: ShellSection[]): SectionRow[] {
  return sections.flatMap((section, position) => [
    { id: section_row_id(section.id), parent_id: null, position, label: section.label, href: section.href },
    ...(section.children ?? []).map((item, item_position) => ({
      id: `${section.id}/${item.id}`, parent_id: section_row_id(section.id), position: item_position, label: item.label, href: item.href,
    })),
  ]);
}

function is_id_list(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function go_to(href: string): void {
  if (href.startsWith("#")) window.location.hash = href.slice(1);
  else window.location.assign(href);
}

interface SectionTreeProps {
  sections: ShellSection[];
  active?: string;
  active_item?: string | null;
  pref_key: string;
  label: string;
}

// The sections as rows folding open onto their items, the folded ones kept in a pref.
export function SectionTree({ sections, active, active_item = null, pref_key, label }: SectionTreeProps) {
  const [collapsed_ids, set_collapsed_ids] = use_pref(pref_key, [] as string[], is_id_list);
  const collapsed = new Set(collapsed_ids);
  const rows = section_rows(sections);
  const item_id = active === undefined || active_item === null ? null : `${active}/${active_item}`;
  const section_id = active === undefined ? null : section_row_id(active);
  // A folded section lights up itself in place of its hidden item.
  const shown_item = item_id !== null && section_id !== null && !collapsed.has(section_id) && rows.some((row) => row.id === item_id);
  return (
    <Tree
      items={rows}
      label={label}
      render_item={(row) => row.label}
      name_of={(row) => row.label}
      collapsed={collapsed}
      on_collapsed_change={(next) => set_collapsed_ids([...next])}
      selected_id={shown_item ? item_id : section_id}
      on_select={(row) => go_to(row.href)}
    />
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export interface ShellSection {
  // The first part of the route the section's pages live under, empty for the overview.
  id: string;
  label: string;
  href: string;
  // The section's items, such as each host, which fold open under its row.
  children?: ShellSectionItem[];
}

export interface ShellSectionItem {
  id: string;
  label: string;
  href: string;
}

// One of the app's views, a row at the top of the sidebar with its icon, raised while `active` names its id.
export interface ShellView {
  id: string;
  label: string;
  href: string;
  icon?: IconGlyph;
}

// The Settings link, last in the sidebar's foot; on_open takes the click from the link, for an app that opens Settings
// itself.
export interface ShellSettings {
  href: string;
  // Lights the link up; true when the active section is "settings" unless set.
  active?: boolean;
  on_open?: () => void;
}

// How wide the sidebar may be dragged, kept under storage_key, or by the app when it passes width and on_change.
export interface SidebarWidth {
  default_width: number;
  min: number;
  max: number;
  storage_key?: string;
  width?: number;
  // Called as the edge is dragged, then with done once it is let go.
  on_change?: (width: number, done: boolean) => void;
}

// A pane docked to the window's right edge beside main, such as a picked item's details or an assistant's conversation:
// its head, with the title and a close button, sits in the top bar above it; where Halon drops the sidebar for the
// phone menu, the pane covers main instead of squeezing it, with its head at its top.
export interface ShellSidePane {
  // Names the pane: its heading, and its name for screen readers.
  title: string;
  // Whether it shows; the app holds it, kept in a pref by use_side_pane when it should outlast a visit.
  open: boolean;
  // Called with false by the close button and by Escape inside the pane.
  on_open_change: (open: boolean) => void;
  // The head's content in place of the title heading, such as an item's checkbox and editable title.
  head?: ReactNode;
  // Buttons in the head before the close button.
  tools?: ReactNode;
  // Makes the pane's left edge draggable on wide screens, as sidebar_width does the sidebar's; 360px wide unless set.
  width?: SidebarWidth;
  content: ReactNode;
}

// Halon's phone layout, where the sidebar becomes the phone menu.
const narrow_query = "(max-width: 700px)";

// The title takes the head's room and is cut short with an ellipsis, keeping the close button at the end.
// On a phone the pane takes the screen below the top bar, its own height rather than main's, so a part pinned to its
// foot, such as a message box, stays in sight; main is hidden behind it, so the window has nothing else to scroll.
function phone_pane_style(has_status_bar: boolean): CSSProperties {
  return { position: "relative", inset: "auto", height: `calc(100dvh - var(--frame-height)${has_status_bar ? " - var(--row-height)" : ""})` };
}

const pane_title_style: CSSProperties = { flex: 1, minWidth: 0, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

// Whether the side pane is open, kept in a pref such as "x-codex-assistant-open" so it stays as it was left.
export function use_side_pane(pref_key: string, initial = false): [open: boolean, set_open: (open: boolean) => void] {
  return use_pref(pref_key, initial, is_boolean);
}

interface ShellProps {
  brand: string;
  // The app's icon, as an image URL, drawn before the brand.
  brand_icon?: string;
  // The brand's full logo, as an image URL, already holding its name, drawn in place of the icon and the name.
  brand_logo?: string;
  // The sidebar's links, unless `views` or `sidebar` are given.
  sections?: ShellSection[];
  // The app's views as rows with icons at the top of the sidebar, its navigation, above any `sidebar` content.
  views?: ShellView[];
  // The section or view to light up, such as the route's first part.
  active?: string;
  // The item of the active section to light up, such as a host's id; its section lights up instead while folded.
  active_item?: string | null;
  // Where the folded sections are kept, such as "x-nix-sidebar-collapsed", once any section has children.
  sections_pref?: string;
  // The sidebar's own content, such as tags or a player, in place of the section links, held in a .sidebar-content box
  // below any `views`.
  sidebar?: ReactNode;
  // Makes the sidebar's edge draggable on wide screens.
  sidebar_width?: SidebarWidth;
  theme: ThemeChoice;
  // Who is signed in, shown in the sidebar's foot; left out, null or empty shows no account name or Sign out.
  user?: string | null;
  // Hides the sidebar and the top bar's tools, such as on the login page; true when user is null unless set.
  logged_out?: boolean;
  // Makes the user's name a link, such as to their account page.
  user_href?: string;
  on_logout?: () => void;
  // Where the brand links to.
  brand_href?: string;
  // Whether the phone menu is open, for an app that opens and closes it itself; the Shell keeps it when this is left out.
  menu_open?: boolean;
  on_menu_open_change?: (open: boolean) => void;
  // A class for the main element, such as one that lays it out as panes.
  main_class?: string;
  // More in the top bar after the brand, such as a search box or the runs in progress.
  tools?: ReactNode;
  // The app's own rows in the sidebar's foot, above the theme, the account and Settings, such as whether the live
  // updates are connected.
  sidebar_foot?: ReactNode;
  // Where Settings is, shown last in the sidebar's foot.
  settings?: ShellSettings;
  // A bar along the foot of the window, such as what is playing or how many rows are picked.
  status_bar?: ReactNode;
  // Changes whenever the view does, so focus and scroll move to the new page.
  view_key?: string;
  // A pane beside main on the right; while it is given, main's children sit in a .main-pane box, so pass it open or
  // closed rather than leaving it out when it closes, or they are drawn anew.
  side_pane?: ShellSidePane;
  // Keeps the window still so only main, or its panes, scroll, as in an app rather than a page.
  contained?: boolean;
  // Heads the sidebar with the brand and leaves the top bar to the tools.
  brand_in_sidebar?: boolean;
  // The Shell's own words in the page's language.
  labels?: ShellLabels;
  children: ReactNode;
}

// A pane's width: the app's own, else the one kept in this browser, else the default.
function use_pane_width(spec: SidebarWidth | undefined): [width: number | undefined, change: (width: number, done: boolean) => void] {
  const [kept, set_kept] = useState(() => spec?.storage_key ? stored_sizes(spec.storage_key, 1)?.[0] : undefined);
  const width = spec ? Math.min(spec.max, Math.max(spec.min, spec.width ?? kept ?? spec.default_width)) : undefined;
  const change = (next: number, done: boolean) => {
    if (spec?.width === undefined) set_kept(next);
    if (done && spec?.storage_key) store_sizes(spec.storage_key, [next]);
    spec?.on_change?.(next, done);
  };
  return [width, change];
}

export function Shell({
  brand, brand_icon, brand_logo, sections = [], views, active, active_item = null, sections_pref = "sidebar-collapsed", sidebar: sidebar_content, sidebar_width, theme, user, logged_out: held_logged_out, user_href, on_logout, brand_href = "#/", tools, sidebar_foot, settings, status_bar, view_key,
  menu_open: held_menu_open, on_menu_open_change, main_class, side_pane, contained = false, brand_in_sidebar = false, labels = shell_labels, children,
}: ShellProps) {
  const [own_menu_open, set_own_menu_open] = useState(false);
  const menu_open = held_menu_open ?? own_menu_open;
  const main = useRef<HTMLElement>(null);
  const menu_button = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const has_content = sidebar_content !== undefined && sidebar_content !== null;
  const folding = sections.some((section) => section.children !== undefined);
  // With views the sidebar holds more than navigation, so it is an aside and only the views are the navigation.
  const Sidebar = views ? "aside" : "nav";
  const first_view = useRef(true);
  const logged_out = held_logged_out ?? user === null;
  const user_name = typeof user === "string" && user !== "" ? user : undefined;
  const [width, change_width] = use_pane_width(sidebar_width);

  // Every opening and closing of the phone menu goes through here, so an app that holds it hears each one.
  function set_menu_open(open: boolean): void {
    if (open === menu_open) return;
    if (held_menu_open === undefined) set_own_menu_open(open);
    on_menu_open_change?.(open);
  }

  // The login page has no theme button, so the saved theme is set here.
  useEffect(() => theme.apply(), []);

  useEffect(() => {
    document.body.classList.toggle("logged-out", logged_out);
    document.body.classList.toggle("menu-open", menu_open);
    document.body.classList.toggle("has-status-bar", status_bar !== undefined);
    document.body.classList.toggle("contained", contained);
  }, [logged_out, menu_open, status_bar !== undefined, contained]);

  // The width also reaches the top bar through the body, so the brand above the sidebar lines up with it.
  useEffect(() => {
    if (width === undefined) return;
    document.body.style.setProperty("--sidebar-width", `${width}px`);
    return () => void document.body.style.removeProperty("--sidebar-width");
  }, [width]);

  useEffect(() => {
    if (menu_open) sidebar.current?.querySelector<HTMLElement>("a[href], button:not(:disabled), input, select, textarea, [tabindex='0']")?.focus();
    if (!menu_open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      set_menu_open(false);
      menu_button.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menu_open]);

  const [pane_width, change_pane_width] = use_pane_width(side_pane?.width);
  const pane_open = side_pane?.open === true;
  // What had focus when the pane opened; undefined while it has not been open, so the first load moves no focus.
  const pane_opener = useRef<Element | null | undefined>(undefined);
  // Halon's phone layout, where the pane covers main and the top bar has no room for its head.
  const narrow = use_media_query(narrow_query);

  // The pane's width reaches its head in the top bar through the body.
  useEffect(() => {
    if (pane_width === undefined) return;
    document.body.style.setProperty("--side-pane-width", `${pane_width}px`);
    return () => void document.body.style.removeProperty("--side-pane-width");
  }, [pane_width]);

  // Focus left behind in a pane that closed goes back to where it was when the pane opened, else to main.
  useEffect(() => {
    if (pane_open) {
      pane_opener.current = document.activeElement;
      return;
    }
    const opener = pane_opener.current;
    if (opener === undefined) return;
    pane_opener.current = undefined;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    else main.current?.focus({ preventScroll: true });
  }, [pane_open]);

  function close_pane(): void {
    side_pane?.on_open_change(false);
  }

  // Escape inside the pane closes it, unless something there took it, or it was typed in a field.
  function escape_pane(event: ReactKeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    close_pane();
  }

  const close_label = side_pane && (labels.close_side_pane ?? shell_labels.close_side_pane!)(side_pane.title);
  const pane_head = side_pane && (
    <header className="side-pane-head" onKeyDown={escape_pane}>
      {side_pane.head ?? <h2 className="side-pane-title" style={pane_title_style}>{side_pane.title}</h2>}
      {side_pane.tools}
      <button className="icon" onClick={close_pane} aria-label={close_label} title={close_label}>×</button>
    </header>
  );

  // A new view closes the menu and takes focus, which tells a screen reader the page changed, but not on the first load.
  useEffect(() => {
    set_menu_open(false);
    // The first load keeps where the browser put it, such as at a heading named in the address.
    if (first_view.current) {
      first_view.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    main.current?.scrollTo?.(0, 0);
  }, [view_key]);

  return (
    <>
      <a className="skip" href="#main">{labels.skip_to_content}</a>
      <header className="topbar">
        <button ref={menu_button} className="icon menu-button" aria-label={labels.open_menu} aria-expanded={menu_open} aria-controls="sidebar" onClick={() => set_menu_open(!menu_open)}>☰</button>
        {!(brand_in_sidebar && !logged_out) && <a href={brand_href} className="brand"><BrandMark brand={brand} icon={brand_icon} logo={brand_logo} /></a>}
        {!logged_out && tools}
        {pane_open && !narrow && !logged_out && pane_head}
      </header>
      <div className="layout" style={width === undefined ? undefined : { "--sidebar-width": `${width}px` } as CSSProperties}>
        <Sidebar ref={sidebar} id="sidebar" className="sidebar" aria-label={views ? undefined : labels.main_navigation}>
          {brand_in_sidebar && <a href={brand_href} className="sidebar-brand"><BrandMark brand={brand} icon={brand_icon} logo={brand_logo} /></a>}
          {views || has_content || folding ? (
            <div className="sidebar-content">
              {views && (
                <nav className="sidebar-nav" aria-label={labels.main_navigation}>
                  {views.map((view) => (
                    <RowLink key={view.id} href={view.href} current={view.id === active} icon={view.icon && <Icon icon={view.icon} />} label={view.label} />
                  ))}
                </nav>
              )}
              {folding && <SectionTree sections={sections} active={active} active_item={active_item} pref_key={sections_pref} label={labels.main_navigation} />}
              {sidebar_content}
            </div>
          ) : (
            <div className="sidebar-links">
              {sections.map((section) => (
                <a key={section.id} href={section.href} data-section={section.id} className={section.id === active ? "active" : undefined} aria-current={section.id === active ? "page" : undefined}>
                  {section.label}
                </a>
              ))}
            </div>
          )}
          <div className="sidebar-foot">
            {sidebar_foot}
            <ThemeRow choice={theme} labels={labels} />
            {user_name !== undefined && (
              <div className="sidebar-account">
                {user_href
                  ? <RowLink href={user_href} current={location.hash === user_href} icon={<PersonIcon />} label={user_name} />
                  : <span className="tree-row"><span className="tree-label"><PersonIcon /><span className="user-name">{user_name}</span></span></span>}
                {on_logout && <button className="tree-row" onClick={on_logout}>{labels.sign_out}</button>}
              </div>
            )}
            {settings && <RowLink href={settings.href} current={settings.active ?? active === "settings"} icon={<CogIcon />} label={labels.settings} on_open={settings.on_open} />}
          </div>
          {sidebar_width && width !== undefined && (
            <ResizeHandle
              side="left"
              size={width}
              min={sidebar_width.min}
              max={sidebar_width.max}
              default_size={sidebar_width.default_width}
              on_resize={(next) => change_width(next, false)}
              on_resize_end={(next) => change_width(next, true)}
              label={labels.resize_sidebar}
              class_name="sidebar-resize"
            />
          )}
        </Sidebar>
        <div className="scrim" hidden={!menu_open} onClick={() => set_menu_open(false)} />
        {side_pane ? (
          <main
            ref={main}
            id="main"
            className={[main_class, "with-side-pane"].filter(Boolean).join(" ")}
            tabIndex={-1}
            // Closed, the pane's column takes no room, so main's children keep their place and their state.
            style={{ "--side-pane-width": pane_open ? (pane_width === undefined ? undefined : `${pane_width}px`) : "0px" } as CSSProperties}
          >
            <div className="main-pane" hidden={narrow && pane_open && !logged_out}>{children}</div>
            {pane_open && !logged_out && (
              <aside className="side-pane" aria-label={side_pane.title} onKeyDown={escape_pane} style={narrow ? phone_pane_style(status_bar !== undefined) : undefined}>
                {side_pane.width && pane_width !== undefined && (
                  <ResizeHandle
                    side="right"
                    size={pane_width}
                    min={side_pane.width.min}
                    max={side_pane.width.max}
                    default_size={side_pane.width.default_width}
                    on_resize={(next) => change_pane_width(next, false)}
                    on_resize_end={(next) => change_pane_width(next, true)}
                    label={(labels.resize_side_pane ?? shell_labels.resize_side_pane!)(side_pane.title)}
                  />
                )}
                {narrow && pane_head}
                <div className="side-pane-body">{side_pane.content}</div>
              </aside>
            )}
          </main>
        ) : (
          <main ref={main} id="main" className={main_class} tabIndex={-1}>{children}</main>
        )}
      </div>
      {status_bar !== undefined && <footer className="status-bar">{status_bar}</footer>}
      <Toasts />
      <Dialogs />
      <ContextMenus />
    </>
  );
}
