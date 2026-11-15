// Picks up a page the build drew, so its search, outline, menus, theme and diagrams work in the browser.

import { hydrateRoot } from "react-dom/client";
import type { PageData } from "../../site/model.ts";
import { NotFound, SitePage } from "../react/site.tsx";
import type { DiagramDrawer } from "./mermaid.ts";
import { pagefind_search } from "./pagefind.ts";
import { load_content, type PageModules } from "./pages.ts";

export interface SiteOptions {
  // Draws ```mermaid blocks, which the build hands in when a page has one.
  draw_diagram?: DiagramDrawer;
}

export async function start_site(pages: PageModules, options: SiteOptions = {}): Promise<void> {
  const page = JSON.parse(document.getElementById("x-site-page")!.textContent!) as PageData;
  const Content = (await load_content(pages, page.source)) ?? NotFound;
  hydrateRoot(
    document.getElementById("root")!,
    <SitePage page={page} Content={Content} search={pagefind_search(page.base, page.ui.search_unavailable)} draw_diagram={options.draw_diagram} />,
  );
}
