// A static site's shape, shared by the build and the page: the site's settings, its pages in each language, the
// address of each, the sidebar each language shows and the data a built page carries to the browser.

import type { SiteMessages } from "./ui_strings.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

export interface LocaleConfig {
  // The language's own name, such as "Español", shown in the language picker.
  label: string;
  // The BCP 47 tag, such as "es" or "pt-BR".
  lang: string;
  dir?: "ltr" | "rtl";
}

export type SocialIcon = "github" | "matrix" | "mastodon" | "discord" | "rss" | "link";

export interface SocialLink {
  icon: SocialIcon;
  label: string;
  href: string;
}

// A label in the default language with its translations by locale key, such as { es: "Guías" }.
interface Labelled {
  label?: string;
  translations?: Record<string, string>;
}

// A link to any address, such as another site.
export interface SidebarLink extends Labelled {
  label: string;
  link: string;
}

// A page of the site by its slug, labelled with its own title unless given one.
export interface SidebarPage extends Labelled {
  slug: string;
}

export interface SidebarGroup extends Labelled {
  label: string;
  items: SidebarEntry[];
  collapsed?: boolean;
}

// Every page in a content folder, ordered by their `sidebar.order` and then by title.
export interface SidebarFolder extends Labelled {
  label: string;
  autogenerate: { directory: string };
  collapsed?: boolean;
}

export type SidebarEntry = SidebarLink | SidebarPage | SidebarGroup | SidebarFolder;

export interface ExtraFile {
  // Where the file goes in the built site, such as "badges/owner/repo.json".
  path: string;
  content: string | Uint8Array;
}

export interface SiteConfig {
  title: string;
  description?: string;
  // The address the site is served at, such as "https://example.github.io", for canonical links and the sitemap.
  site?: string;
  // The path the site lives under, "/" for a user or organisation site and "/<repo>/" for a project site.
  base?: string;
  // The folder of Markdown and MDX pages, relative to the site's folder.
  content?: string;
  // Files copied into the site as they are, such as the favicon.
  public?: string;
  // The site's icon, drawn before its title, as a file relative to the site's folder.
  logo?: string;
  // The favicon's path inside the public folder, or an address.
  favicon?: string;
  social?: SocialLink[];
  // The address a page's source path is added to for its "Edit this page" link.
  edit_link?: string;
  // Shows each page's last commit date, read from git.
  last_updated?: boolean;
  // Languages by key; "root" is served at the top and every other key under "/<key>/".
  locales?: Record<string, LocaleConfig>;
  sidebar?: SidebarEntry[];
  // Stylesheets the page imports, such as Halon's, in order.
  css?: string[];
  // The frame's words by language tag, over the built-in ones.
  ui?: Record<string, SiteMessages>;
  // Where the reader's theme choice is kept in their browser.
  theme_key?: string;
  // Turns the search off.
  search?: boolean;
  // Old addresses that move to new ones, both inside the site, such as { "/guide.html": "/guide/" }.
  redirects?: Record<string, string>;
  // More files for the built site, such as JSON made from the site's data.
  files?: () => ExtraFile[] | Promise<ExtraFile[]>;
}

export function define_site(config: SiteConfig): SiteConfig {
  return config;
}

export const root_locale = "root";

const english_root: Record<string, LocaleConfig> = { [root_locale]: { label: "English", lang: "en" } };

export function site_locales(config: SiteConfig): Record<string, LocaleConfig> {
  return config.locales ?? english_root;
}

// ── Pages ────────────────────────────────────────────────────────────────────

export interface HeroAction {
  text: string;
  link: string;
  variant?: "primary" | "secondary" | "minimal";
}

export interface Frontmatter {
  title?: string;
  description?: string;
  // "splash" is a landing page: a hero across the top and no outline.
  template?: "doc" | "splash";
  hero?: { title?: string; tagline?: string; image?: string; actions?: HeroAction[] };
  sidebar?: { order?: number; label?: string; hidden?: boolean };
  // false hides the outline.
  toc?: boolean;
}

// One content file: its locale and slug, read from where it sits, and its frontmatter.
export interface SourcePage {
  // The file's path under the content folder, such as "es/guidelines/index.mdx".
  id: string;
  locale: string;
  // The page's path inside its locale, "" for the home page and "guidelines" for guidelines/index.
  slug: string;
  frontmatter: Frontmatter;
  // The last commit that touched the file, as an ISO date.
  last_updated?: string;
}

// The locale and slug a content file serves, from its path under the content folder.
export function place_of_file(id: string, locale_keys: readonly string[]): { locale: string; slug: string } {
  const parts = id.replace(/\.mdx?$/, "").split("/");
  const locale = parts.length > 1 && parts[0] !== root_locale && locale_keys.includes(parts[0]) ? parts.shift()! : root_locale;
  if (parts.at(-1) === "index") parts.pop();
  return { locale, slug: parts.join("/") };
}

// The address of a slug in a locale, without the base: "/", "/join/" or "/es/join/".
export function page_path(locale: string, slug: string): string {
  const parts = [locale === root_locale ? "" : locale, slug].filter(Boolean);
  return parts.length === 0 ? "/" : `/${parts.join("/")}/`;
}

// A path inside the site with the base in front, such as "/repo/join/" for "/join/"; addresses and anchors pass as they are.
export function with_base(base: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${base.replace(/\/$/, "")}${path}`;
}

export interface Route {
  path: string;
  locale: string;
  slug: string;
  page: SourcePage;
  // Shown from the default language because the locale has no page of its own here.
  is_fallback: boolean;
}

// Every page each locale serves: its own pages, and the default language's where it has none.
export function plan_routes(pages: readonly SourcePage[], locale_keys: readonly string[]): Route[] {
  const default_locale = locale_keys.includes(root_locale) ? root_locale : locale_keys[0];
  const by_place = new Map(pages.map((page) => [`${page.locale}:${page.slug}`, page]));
  const routes: Route[] = [];
  for (const locale of locale_keys) {
    const slugs = new Set(pages.filter((page) => page.locale === locale || page.locale === default_locale).map((page) => page.slug));
    for (const slug of [...slugs].sort()) {
      const own = by_place.get(`${locale}:${slug}`);
      const page = own ?? by_place.get(`${default_locale}:${slug}`)!;
      routes.push({ path: page_path(locale, slug), locale, slug, page, is_fallback: own === undefined });
    }
  }
  return routes;
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

export type NavItem =
  | { kind: "link"; label: string; href: string }
  | { kind: "group"; label: string; items: NavItem[]; collapsed: boolean };

function label_in(entry: Labelled, locale: string, fallback: string): string {
  return entry.translations?.[locale] ?? entry.label ?? fallback;
}

function title_of(route: Route): string {
  return route.page.frontmatter.sidebar?.label ?? route.page.frontmatter.title ?? route.slug;
}

// The sidebar one locale shows, its page links pointing into that locale and labelled with each page's own title.
export function build_sidebar(entries: readonly SidebarEntry[], routes: readonly Route[], locale: string, base: string): NavItem[] {
  const own_routes = routes.filter((route) => route.locale === locale);
  const by_slug = new Map(own_routes.map((route) => [route.slug, route]));

  const link_to = (route: Route, label?: string): NavItem => ({ kind: "link", label: label ?? title_of(route), href: with_base(base, route.path) });

  const resolve = (entry: SidebarEntry): NavItem[] => {
    if ("link" in entry) return [{ kind: "link", label: label_in(entry, locale, entry.link), href: with_base(base, entry.link) }];
    if ("slug" in entry) {
      const route = by_slug.get(entry.slug.replace(/^\/|\/$/g, ""));
      if (!route) throw new Error(`The sidebar names the page "${entry.slug}", which does not exist.`);
      return [link_to(route, entry.label === undefined && entry.translations === undefined ? undefined : label_in(entry, locale, title_of(route)))];
    }
    if ("items" in entry) return [{ kind: "group", label: label_in(entry, locale, ""), items: entry.items.flatMap(resolve), collapsed: entry.collapsed ?? false }];
    const directory = entry.autogenerate.directory.replace(/^\/|\/$/g, "");
    const collapsed = entry.collapsed ?? false;
    return [{ kind: "group", label: label_in(entry, locale, directory), items: folder_items(directory, collapsed), collapsed }];
  };

  // A folder's own pages as links and each subfolder as a nested group, however deep, sorted together.
  const folder_items = (directory: string, collapsed: boolean): NavItem[] => {
    const prefix = directory === "" ? "" : `${directory}/`;
    const places: { order: number; title: string; item: NavItem }[] = [];
    const subfolders = new Set<string>();
    for (const route of own_routes) {
      if (route.page.frontmatter.sidebar?.hidden) continue;
      if (route.slug !== directory && !route.slug.startsWith(prefix)) continue;
      const rest = route.slug === directory ? "" : route.slug.slice(prefix.length);
      if (rest === "" || (!rest.includes("/") && !is_index(route))) places.push({ order: order_of(route), title: title_of(route), item: link_to(route) });
      else subfolders.add(rest.split("/")[0]);
    }
    for (const name of subfolders) {
      const index = by_slug.get(`${prefix}${name}`);
      const label = index && is_index(index) ? (index.page.frontmatter.title ?? name) : name;
      places.push({ order: Number.MAX_SAFE_INTEGER, title: label, item: { kind: "group", label, items: folder_items(`${prefix}${name}`, collapsed), collapsed } });
    }
    places.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
    return places.map((place) => place.item);
  };

  return entries.flatMap(resolve);
}

function is_index(route: Route): boolean {
  return /(^|\/)index\.mdx?$/.test(route.page.id);
}

function order_of(route: Route): number {
  return route.page.frontmatter.sidebar?.order ?? Number.MAX_SAFE_INTEGER;
}

// The sidebar's links in reading order.
export function nav_links(items: readonly NavItem[]): { label: string; href: string }[] {
  return items.flatMap((item) => (item.kind === "link" ? [{ label: item.label, href: item.href }] : nav_links(item.items)));
}

// The pages before and after one in the sidebar's reading order, skipping links that leave the site.
export function neighbours(items: readonly NavItem[], href: string): { previous?: { label: string; href: string }; next?: { label: string; href: string } } {
  const links = nav_links(items).filter((link) => link.href.startsWith("/") && !link.href.startsWith("//") && !link.href.includes("#"));
  const index = links.findIndex((link) => link.href === href);
  if (index === -1) return {};
  return { previous: links[index - 1], next: links[index + 1] };
}

// ── A built page's data ──────────────────────────────────────────────────────

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface Language {
  key: string;
  label: string;
  lang: string;
  href: string;
}

// Everything a page needs to draw itself, written into the page for the browser to pick up again.
export interface PageData {
  // The content file the page is drawn from, empty for the page that says a page is missing.
  source: string;
  path: string;
  href: string;
  base: string;
  locale: string;
  lang: string;
  dir: "ltr" | "rtl";
  title: string;
  description?: string;
  template: "doc" | "splash";
  hero?: Frontmatter["hero"];
  headings: Heading[];
  toc: boolean;
  site: {
    title: string;
    logo?: string;
    social: SocialLink[];
    search: boolean;
    home: string;
    theme_key: string;
  };
  nav: NavItem[];
  previous?: { label: string; href: string };
  next?: { label: string; href: string };
  edit_url?: string;
  last_updated?: string;
  // Names the default language when this page is shown in it for want of a translation.
  fallback_language?: string;
  languages: Language[];
  ui: Record<string, string>;
}

// ── Headings ─────────────────────────────────────────────────────────────────

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decode_entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return entities[name.toLowerCase()] ?? whole;
  });
}

// The second- and third-level headings of a page's HTML that carry an id, as its outline, their anchor links left out.
export function extract_headings(html: string, levels: readonly number[] = [2, 3]): Heading[] {
  const headings: Heading[] = [];
  for (const match of html.matchAll(/<h([1-6])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const level = Number(match[1]);
    if (!levels.includes(level)) continue;
    const inner = match[3].replace(/<a\b[^>]*class="heading-anchor"[^>]*>[\s\S]*?<\/a>/g, "");
    const text = decode_entities(inner.replace(/<[^>]+>/g, "")).trim();
    if (text !== "") headings.push({ id: decode_entities(match[2]), text, level });
  }
  return headings;
}
