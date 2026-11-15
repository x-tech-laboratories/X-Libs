// A site's pages drawn to HTML at build time, for the browser to pick up again with start_site.

import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import type { PageData } from "../../site/model.ts";
import { NotFound, SitePage } from "../react/site.tsx";
import { pagefind_search } from "./pagefind.ts";

export { load_content, type PageModules } from "./pages.ts";

// The page's content alone, from which the build reads its headings.
export function render_content(page: PageData, Content: ComponentType = NotFound): string {
  return renderToString(<SitePage page={{ ...page, headings: [] }} Content={Content} />);
}

export function render_page(page: PageData, Content: ComponentType = NotFound): string {
  return renderToString(<SitePage page={page} Content={Content} search={pagefind_search(page.base, page.ui.search_unavailable)} />);
}
