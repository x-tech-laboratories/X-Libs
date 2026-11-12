// The frame around every view: the top bar, the sidebar that slides in on phones and resizes on wide screens, its foot
// pinned with the theme, the signed-in user and Settings, a status bar, and the toasts, dialogs and menus.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { current_route, type Route } from "../router.ts";
import { store_sizes, stored_sizes } from "../split.ts";
import { next_theme, type Theme, type ThemeChoice } from "../theme.ts";
import { Dialogs } from "./dialog.tsx";
import { ContextMenus } from "./menus.tsx";
import { ResizeHandle } from "./split.tsx";
import { Toasts } from "./toasts.tsx";

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
  const [icon, text] = theme_labels[theme];
  return (
    <button id="theme" className="icon" title={`${text} (click to change)`} aria-label={`${text}, click to change`} onClick={() => choice.set(next_theme(choice.get()))}>
      {icon}
    </button>
  );
}

const theme_names: Record<Theme, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

// The theme as a sidebar row, its icon and name showing the current one, stepping to the next on each click.
export function ThemeRow({ choice }: { choice: ThemeChoice }) {
  const [theme, set_theme] = useState(choice.get);
  useEffect(() => choice.on_change(set_theme), []);
  return (
    <button className="tree-row" title="Click to change the theme" onClick={() => choice.set(next_theme(choice.get()))}>
      <span className="tree-label"><ThemeIcon theme={theme} /><span>{theme_names[theme]}</span></span>
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
function FootLink({ href, current, icon, label, on_open }: { href: string; current: boolean; icon: ReactNode; label: string; on_open?: () => void }) {
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

// ── Shell ────────────────────────────────────────────────────────────────────

export interface ShellSection {
  // The first part of the route the section's pages live under, empty for the overview.
  id: string;
  label: string;
  href: string;
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

interface ShellProps {
  brand: string;
  // The app's icon, as an image URL, drawn before the brand.
  brand_icon?: string;
  // The sidebar's links, unless `sidebar` gives its whole content.
  sections?: ShellSection[];
  // The section to light up, such as the route's first part.
  active?: string;
  // The sidebar's own content, such as views and tags, in place of the section links, held in a .sidebar-content box.
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
  // Keeps the window still so only main, or its panes, scroll, as in an app rather than a page.
  contained?: boolean;
  // Heads the sidebar with the brand and leaves the top bar to the tools.
  brand_in_sidebar?: boolean;
  children: ReactNode;
}

// The sidebar's width: the app's own, else the one kept in this browser, else the default.
function use_sidebar_width(spec: SidebarWidth | undefined): [width: number | undefined, change: (width: number, done: boolean) => void] {
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
  brand, brand_icon, sections = [], active, sidebar: sidebar_content, sidebar_width, theme, user, logged_out: held_logged_out, user_href, on_logout, brand_href = "#/", tools, sidebar_foot, settings, status_bar, view_key,
  menu_open: held_menu_open, on_menu_open_change, main_class, contained = false, brand_in_sidebar = false, children,
}: ShellProps) {
  const [own_menu_open, set_own_menu_open] = useState(false);
  const menu_open = held_menu_open ?? own_menu_open;
  const main = useRef<HTMLElement>(null);
  const menu_button = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const first_view = useRef(true);
  const logged_out = held_logged_out ?? user === null;
  const user_name = typeof user === "string" && user !== "" ? user : undefined;
  const [width, change_width] = use_sidebar_width(sidebar_width);

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

  // A new view closes the menu and takes focus, which tells a screen reader the page changed, but not on the first load.
  useEffect(() => {
    set_menu_open(false);
    if (!first_view.current) main.current?.focus({ preventScroll: true });
    first_view.current = false;
    window.scrollTo(0, 0);
    main.current?.scrollTo?.(0, 0);
  }, [view_key]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <button ref={menu_button} className="icon menu-button" aria-label="Open the menu" aria-expanded={menu_open} aria-controls="sidebar" onClick={() => set_menu_open(!menu_open)}>☰</button>
        {!(brand_in_sidebar && !logged_out) && <a href={brand_href} className="brand">{brand_icon && <img className="brand-icon" src={brand_icon} alt="" />}{brand}</a>}
        {!logged_out && tools}
      </header>
      <div className="layout" style={width === undefined ? undefined : { "--sidebar-width": `${width}px` } as CSSProperties}>
        <nav ref={sidebar} id="sidebar" className="sidebar" aria-label="Main">
          {brand_in_sidebar && <a href={brand_href} className="sidebar-brand">{brand_icon && <img className="brand-icon" src={brand_icon} alt="" />}{brand}</a>}
          {sidebar_content !== undefined && sidebar_content !== null ? <div className="sidebar-content">{sidebar_content}</div> : (
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
            <ThemeRow choice={theme} />
            {user_name !== undefined && (
              <div className="sidebar-account">
                {user_href
                  ? <FootLink href={user_href} current={location.hash === user_href} icon={<PersonIcon />} label={user_name} />
                  : <span className="tree-row"><span className="tree-label"><PersonIcon /><span className="user-name">{user_name}</span></span></span>}
                {on_logout && <button className="tree-row" onClick={on_logout}>Sign out</button>}
              </div>
            )}
            {settings && <FootLink href={settings.href} current={settings.active ?? active === "settings"} icon={<CogIcon />} label="Settings" on_open={settings.on_open} />}
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
              label="Resize the sidebar"
              class_name="sidebar-resize"
            />
          )}
        </nav>
        <div className="scrim" hidden={!menu_open} onClick={() => set_menu_open(false)} />
        <main ref={main} id="main" className={main_class} tabIndex={-1}>{children}</main>
      </div>
      {status_bar !== undefined && <footer className="status-bar">{status_bar}</footer>}
      <Toasts />
      <Dialogs />
      <ContextMenus />
    </>
  );
}
