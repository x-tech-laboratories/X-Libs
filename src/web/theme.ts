// The light, dark or system theme, kept in this browser or the app's own settings, and set as data-theme on the page.

export type Theme = "system" | "light" | "dark";

export interface ThemeChoice {
  get(): Theme;
  set(theme: Theme): void;
  // Returns the function that stops listening.
  on_change(listener: (theme: Theme) => void): () => void;
  // Sets the theme on the page, the saved one when none is given.
  apply(theme?: Theme): void;
}

// Where the choice is kept, such as the app's own settings; nothing read means the system theme.
export interface ThemeStorage {
  read(): Theme | undefined;
  write(theme: Theme): void;
}

// The choice kept in this browser under the storage key, such as "x-nix-theme".
export function local_theme_storage(storage_key: string): ThemeStorage {
  return {
    read: () => {
      try {
        const saved = localStorage.getItem(storage_key);
        return saved === "light" || saved === "dark" ? saved : undefined;
      } catch {
        return undefined;
      }
    },
    write: (theme) => {
      try {
        if (theme === "system") localStorage.removeItem(storage_key);
        else localStorage.setItem(storage_key, theme);
      } catch {
        // Without storage the choice lasts until the page is closed.
      }
    },
  };
}

// The choice kept under a storage key in this browser, or in the storage the app hands over.
export function theme_choice(where: string | ThemeStorage): ThemeChoice {
  const storage = typeof where === "string" ? local_theme_storage(where) : where;
  const listeners = new Set<(theme: Theme) => void>();

  const get = (): Theme => storage.read() ?? "system";

  const apply = (theme: Theme = get()): void => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    for (const listener of listeners) listener(theme);
  };

  const set = (theme: Theme): void => {
    storage.write(theme);
    apply(theme);
  };

  return { get, set, apply, on_change: (listener) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  } };
}

// The header's button steps through system, light and dark.
export function next_theme(theme: Theme): Theme {
  return theme === "system" ? "light" : theme === "light" ? "dark" : "system";
}

// Inside a host that hands over its own colours as --sidebar-* variables, such as the Linux sidebar, the page takes them; says whether it did.
export function follow_host_theme(): boolean {
  const is_hosted = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-bg").trim() !== "";
  document.documentElement.classList.toggle("follows-host-theme", is_hosted);
  return is_hosted;
}
