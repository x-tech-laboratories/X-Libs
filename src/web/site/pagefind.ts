// Search over a built site through Pagefind, chosen because it indexes the finished pages at build time and loads only
// the parts of its index a search needs, so it scales from a handful of pages to thousands with no server; it keeps a
// separate index per language and finds the heading each match sits under.

import type { SearchHit } from "../react/search_dialog.tsx";

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: { title?: string };
  sub_results?: { title: string; url: string; excerpt: string }[];
}

interface Pagefind {
  options(options: Record<string, unknown>): Promise<void>;
  search(query: string): Promise<{ results: { data(): Promise<PagefindResultData> }[] }>;
}

// Searches the index the build wrote under the site's base, loading it on the first search; unavailable_message is the
// error when there is no index, such as on the dev server.
export function pagefind_search(base: string, unavailable_message: string, limit = 8): (query: string) => Promise<SearchHit[]> {
  let loading: Promise<Pagefind> | undefined;

  const load = async (): Promise<Pagefind> => {
    const pagefind = (await import(/* @vite-ignore */ `${base}pagefind/pagefind.js`)) as Pagefind;
    await pagefind.options({ baseUrl: base, excerptLength: 24 });
    return pagefind;
  };

  return async (query) => {
    loading ??= load();
    let pagefind: Pagefind;
    try {
      pagefind = await loading;
    } catch {
      loading = undefined;
      throw new Error(unavailable_message);
    }
    const found = await pagefind.search(query);
    const pages = await Promise.all(found.results.slice(0, limit).map((result) => result.data()));
    return pages.map((page) => ({
      title: page.meta.title ?? page.url,
      href: page.url,
      excerpt: page.excerpt,
      parts: (page.sub_results ?? []).filter((part) => part.url !== page.url).slice(0, 3).map((part) => ({ title: part.title, href: part.url, excerpt: part.excerpt })),
    }));
  };
}
