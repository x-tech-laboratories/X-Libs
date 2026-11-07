// The light, dark or system theme, kept in this browser and set as data-theme on the page.

export type Theme = "system" | "light" | "dark";

export interface ThemeChoice {
  get(): Theme;
  set(theme: Theme): void;
  // Returns the function that stops listening.
  on_change(listener: (theme: Theme) => void): () => void;
  // Sets the theme on the page, the saved one when none is given.
  apply(theme?: Theme): void;
}

// The choice kept under the storage key, such as "x-nix-theme".
export function theme_choice(storage_key: string): ThemeChoice {
  const listeners = new Set<(theme: Theme) => void>();

  const get = (): Theme => {
    try {
      const saved = localStorage.getItem(storage_key);
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  };

  const apply = (theme: Theme = get()): void => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    for (const listener of listeners) listener(theme);
  };

  const set = (theme: Theme): void => {
    try {
      if (theme === "system") localStorage.removeItem(storage_key);
      else localStorage.setItem(storage_key, theme);
    } catch {
      // Without storage the choice lasts until the page is closed.
    }
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
