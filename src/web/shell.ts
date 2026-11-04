// The frame around every view: the sidebar that slides in on phones, the section it lights up, and the theme button.

import { next_theme, type Theme, type ThemeChoice } from "./theme.ts";

// ── Menu ─────────────────────────────────────────────────────────────────────

export interface SidebarMenu {
  close(): void;
}

// The menu button opens the sidebar over a scrim, and the scrim or Escape closes it again.
export function sidebar_menu(menu: HTMLButtonElement, sidebar: HTMLElement, scrim: HTMLElement): SidebarMenu {
  const close = () => {
    document.body.classList.remove("menu-open");
    menu.setAttribute("aria-expanded", "false");
    scrim.hidden = true;
  };
  menu.addEventListener("click", () => {
    const open = !document.body.classList.contains("menu-open");
    document.body.classList.toggle("menu-open", open);
    menu.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
    if (open) sidebar.querySelector<HTMLElement>("a")?.focus();
  });
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
      close();
      menu.focus();
    }
  });
  return { close };
}

// Lights up the sidebar link whose data-section names the section, and marks it as the current page.
export function mark_section(sidebar: HTMLElement, section: string): void {
  for (const item of sidebar.querySelectorAll<HTMLAnchorElement>("a[data-section]")) {
    const active = item.dataset.section === section;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}

// ── Theme ────────────────────────────────────────────────────────────────────

const theme_labels: Record<Theme, [icon: string, text: string]> = { system: ["◐", "Theme: system"], light: ["☀", "Theme: light"], dark: ["☾", "Theme: dark"] };

// The button steps through system, light and dark, its glyph and label showing the current one.
export function theme_button(button: HTMLButtonElement, choice: ThemeChoice): void {
  const show = (theme: Theme) => {
    const [icon, text] = theme_labels[theme];
    button.textContent = icon;
    button.title = `${text} (click to change)`;
    button.setAttribute("aria-label", `${text}, click to change`);
  };
  choice.on_change(show);
  button.addEventListener("click", () => choice.set(next_theme(choice.get())));
  choice.apply();
}
