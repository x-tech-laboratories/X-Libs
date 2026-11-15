// Picks up a page the build drew, so its search, outline, menus and theme work in the browser.

import { hydrateRoot } from "react-dom/client";
import type { PageData } from "../../site/model.ts";
import { NotFound, SitePage } from "../react/site.tsx";
import { pagefind_search } from "./pagefind.ts";
import { load_content, type PageModules } from "./pages.ts";

export async function start_site(pages: PageModules): Promise<void> {
  const page = JSON.parse(document.getElementById("x-site-page")!.textContent!) as PageData;
  const Content = (await load_content(pages, page.source)) ?? NotFound;
  hydrateRoot(document.getElementById("root")!, <SitePage page={page} Content={Content} search={pagefind_search(page.base, page.ui.search_unavailable)} />);
}
