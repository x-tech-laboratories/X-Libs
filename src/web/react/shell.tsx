// The frame around every view: the top bar, the sidebar that slides in on phones, the theme button, and the toasts and dialogs.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { current_route, type Route } from "../router.ts";
import { next_theme, type Theme, type ThemeChoice } from "../theme.ts";
import { Dialogs } from "./dialog.tsx";
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

// ── Shell ────────────────────────────────────────────────────────────────────

export interface ShellSection {
  // The first part of the route the section's pages live under, empty for the overview.
  id: string;
  label: string;
  href: string;
}

interface ShellProps {
  brand: string;
  sections: ShellSection[];
  // The section to light up, such as the route's first part.
  active: string;
  theme: ThemeChoice;
  // Who is logged in, or null on the login page, which hides the sidebar and the top bar's tools.
  user: string | null;
  // Makes the user's name a link, such as to their account page.
  user_href?: string;
  on_logout?: () => void;
  // More in the top bar after the brand, such as a search box or the runs in progress.
  tools?: ReactNode;
  // What sits at the foot of the sidebar, such as whether the live updates are connected.
  sidebar_foot?: ReactNode;
  // Changes whenever the view does, so focus and scroll move to the new page.
  view_key?: string;
  children: ReactNode;
}

export function Shell({ brand, sections, active, theme, user, user_href, on_logout, tools, sidebar_foot, view_key, children }: ShellProps) {
  const [menu_open, set_menu_open] = useState(false);
  const main = useRef<HTMLElement>(null);
  const menu_button = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const first_view = useRef(true);
  const logged_out = user === null;

  // The login page has no theme button, so the saved theme is set here.
  useEffect(() => theme.apply(), []);

  useEffect(() => {
    document.body.classList.toggle("logged-out", logged_out);
    document.body.classList.toggle("menu-open", menu_open);
  }, [logged_out, menu_open]);

  useEffect(() => {
    if (menu_open) sidebar.current?.querySelector<HTMLElement>("a")?.focus();
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
  }, [view_key]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <button ref={menu_button} className="icon menu-button" aria-label="Open the menu" aria-expanded={menu_open} aria-controls="sidebar" onClick={() => set_menu_open(!menu_open)}>☰</button>
        <a href="#/" className="brand">{brand}</a>
        {!logged_out && tools}
        {!logged_out && <ThemeButton choice={theme} />}
        {!logged_out && (user_href ? <a className="account-link" href={user_href}>{user}</a> : <span className="user-name">{user}</span>)}
        {!logged_out && on_logout && <button onClick={on_logout}>Log out</button>}
      </header>
      <div className="layout">
        <nav ref={sidebar} id="sidebar" className="sidebar" aria-label="Main">
          {sections.map((section) => (
            <a key={section.id} href={section.href} data-section={section.id} className={section.id === active ? "active" : undefined} aria-current={section.id === active ? "page" : undefined}>
              {section.label}
            </a>
          ))}
          {sidebar_foot}
        </nav>
        <div className="scrim" hidden={!menu_open} onClick={() => set_menu_open(false)} />
        <main ref={main} id="main" tabIndex={-1}>{children}</main>
      </div>
      <Toasts />
      <Dialogs />
    </>
  );
}
