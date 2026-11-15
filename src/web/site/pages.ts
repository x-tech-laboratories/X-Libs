// The page modules a site's build hands its server and browser entries, by content file.

import type { ComponentType } from "react";

export type PageModule = { default: ComponentType };

export type PageModules = Record<string, () => Promise<PageModule>>;

// The content a page is drawn from, or none for the page that says a page is missing.
export async function load_content(pages: PageModules, source: string): Promise<ComponentType | undefined> {
  const load = pages[source];
  return load ? (await load()).default : undefined;
}
