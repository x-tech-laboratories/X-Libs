// A static site's page in the X-apps' frame: the Shell with the site's sidebar, search, links and language picker in
// the top bar, the page's outline beside it, and edit, date and previous and next links at its foot. The pieces a page's
// MDX can use, such as cards and asides, are here too.

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { with_base, type NavItem, type PageData, type SocialLink } from "../../site/model.ts";
import { create_translator, type Translate } from "../../i18n.ts";
import { theme_choice } from "../theme.ts";
import type { DiagramDrawer } from "../site/mermaid.ts";
import { Card as LayoutCard, Cards } from "./layout.tsx";
import { Outline } from "./outline.tsx";
import { SearchButton, SearchDialog, type SearchHit } from "./search_dialog.tsx";
import { Shell, type ShellLabels } from "./shell.tsx";

export type { PageData } from "../../site/model.ts";

// ── The page's data ──────────────────────────────────────────────────────────

const SiteData = createContext<PageData | null>(null);

// The page being drawn, for a piece of its content that needs the site's base or language.
export function use_site_page(): PageData {
  const page = useContext(SiteData);
  if (!page) throw new Error("Site content is drawn outside a SitePage.");
  return page;
}

// ── Diagrams ─────────────────────────────────────────────────────────────────

const DiagramDrawing = createContext<DiagramDrawer | null>(null);

// Whether the page shows its dark scheme: the theme picked, else the system's, followed as either changes.
function use_dark_page(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const media = matchMedia("(prefers-color-scheme: dark)");
      const observer = new MutationObserver(changed);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      media.addEventListener("change", changed);
      return () => {
        observer.disconnect();
        media.removeEventListener("change", changed);
      };
    },
    () => {
      const theme = document.documentElement.dataset.theme;
      return theme === undefined ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
    },
    () => false,
  );
}

// A ```mermaid block: its source until the page has drawn it, then the diagram, drawn again when the scheme changes.
function Diagram({ source }: { source: string }) {
  const draw = useContext(DiagramDrawing);
  const dark = use_dark_page();
  const [svg, set_svg] = useState<string | null>(null);
  useEffect(() => {
    if (draw === null) return;
    let shown = true;
    draw(source, dark).then((drawn) => shown && set_svg(drawn), () => shown && set_svg(null));
    return () => {
      shown = false;
    };
  }, [draw, source, dark]);
  if (svg === null) return <pre className="site-diagram-source" data-pagefind-ignore="">{source}</pre>;
  return <div className="site-diagram" data-pagefind-ignore="" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// A Markdown <pre>: a diagram when the build marked it as mermaid, else code as it is.
function SitePre({ "data-mermaid": mermaid, ...props }: ComponentProps<"pre"> & { "data-mermaid"?: string }) {
  if (mermaid === undefined) return <pre {...props} />;
  return <Diagram source={typeof props.children === "string" ? props.children : String(props.children ?? "")} />;
}

const content_components = { pre: SitePre };

// ── The frame ────────────────────────────────────────────────────────────────

// A page's content, from its Markdown or MDX, which takes the components its HTML is drawn with.
type PageContent = ComponentType<{ components?: Record<string, ComponentType<never>> }>;

interface SitePageProps {
  page: PageData;
  Content: PageContent;
  // Finds search hits; the search button is left out without it.
  search?: (query: string) => Promise<SearchHit[]>;
  // Draws the page's ```mermaid blocks; they stay as their source without it.
  draw_diagram?: DiagramDrawer;
}

export function SitePage({ page, Content, search, draw_diagram }: SitePageProps) {
  const t: Translate = create_translator(page.ui);
  const theme = useMemo(() => theme_choice(page.site.theme_key), [page.site.theme_key]);
  const [is_searching, set_searching] = useState(false);
  const labels: ShellLabels = {
    skip_to_content: t("skip_to_content"),
    open_menu: t("open_menu"),
    main_navigation: t("main_navigation"),
    resize_sidebar: t("resize_sidebar"),
    sign_out: "",
    settings: "",
    theme_names: { system: t("theme_system"), light: t("theme_light"), dark: t("theme_dark") },
    change_theme: t("change_theme"),
  };

  const tools = (
    <div className="site-tools">
      {search && page.site.search && <SearchButton label={t("search")} on_open={() => set_searching(true)} />}
      <div className="site-tools-end">
        <SocialLinks links={page.site.social} />
        <LanguagePicker page={page} label={t("language")} />
      </div>
    </div>
  );

  return (
    <SiteData.Provider value={page}>
      <DiagramDrawing.Provider value={draw_diagram ?? null}>
        <Shell
          brand={page.site.title}
          brand_icon={page.site.logo_replaces_title ? undefined : page.site.logo}
          brand_logo={page.site.logo_replaces_title ? page.site.logo : undefined}
          brand_href={page.site.home}
          sidebar={<SiteNav items={page.nav} current={page.href} />}
          theme={theme}
          tools={tools}
          labels={labels}
          view_key={page.href}
        >
          {page.template === "splash" ? <SplashLayout page={page} Content={Content} t={t} /> : <DocLayout page={page} Content={Content} t={t} />}
        </Shell>
        {is_searching && search && (
          <SearchDialog
            search={search}
            on_close={() => set_searching(false)}
            labels={{ title: t("search_title"), placeholder: t("search_placeholder"), no_results: t("search_no_results"), searching: t("search_searching") }}
          />
        )}
      </DiagramDrawing.Provider>
    </SiteData.Provider>
  );
}

interface LayoutProps {
  page: PageData;
  Content: PageContent;
  t: Translate;
}

// Search indexes only a page's own words, so the missing-page page and one shown in the default language for want of a
// translation are left out.
function search_body(page: PageData): { "data-pagefind-body"?: "" } {
  return page.source !== "" && page.fallback_language === undefined ? { "data-pagefind-body": "" } : {};
}

function DocLayout({ page, Content, t }: LayoutProps) {
  const has_outline = page.toc && page.headings.length > 0;
  const outline = [{ heading: t("on_this_page"), items: page.headings.map((heading) => ({ target: heading.id, label: heading.text, level: heading.level })) }];
  return (
    <div className={has_outline ? "site-page with-outline" : "site-page"}>
      <div className="site-main">
        {has_outline && (
          <details className="site-outline-narrow">
            <summary>{t("on_this_page")}</summary>
            <Outline groups={[{ items: outline[0].items }]} label={t("on_this_page")} update_hash />
          </details>
        )}
        <article className="site-article" {...search_body(page)}>
          <h1 className="site-title">{page.title}</h1>
          {page.description && <p className="site-lead">{page.description}</p>}
          {page.fallback_language && <p className="banner site-notice">{t("not_translated", { language: page.fallback_language })}</p>}
          <div className="markdown site-content"><Content components={content_components} /></div>
        </article>
        <PageFoot page={page} t={t} />
      </div>
      {has_outline && (
        <aside className="site-outline">
          <Outline groups={outline} label={t("on_this_page")} update_hash />
        </aside>
      )}
    </div>
  );
}

function SplashLayout({ page, Content, t }: LayoutProps) {
  const hero = page.hero ?? {};
  return (
    <div className="site-page splash">
      <div className="site-main">
        <article className="site-article" {...search_body(page)}>
          <header className="site-hero">
            <div className="site-hero-text">
              <h1 className="site-title">{hero.title ?? page.title}</h1>
              {(hero.tagline ?? page.description) && <p className="site-hero-tagline">{hero.tagline ?? page.description}</p>}
              {hero.actions && hero.actions.length > 0 && (
                <div className="site-hero-actions">
                  {hero.actions.map((action) => (
                    <a key={action.link} href={with_base(page.base, action.link)} className={action_class(action.variant)}>
                      {action.text}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {hero.image && <img className="site-hero-image" src={hero.image} alt="" />}
          </header>
          {page.fallback_language && <p className="banner site-notice">{t("not_translated", { language: page.fallback_language })}</p>}
          <div className="markdown site-content"><Content components={content_components} /></div>
        </article>
        <PageFoot page={page} t={t} />
      </div>
    </div>
  );
}

function action_class(variant: "primary" | "secondary" | "minimal" = "primary"): string {
  return variant === "primary" ? "button accent solid" : variant === "secondary" ? "button" : "button minimal";
}

// The edit link, the last change and the previous and next pages.
function PageFoot({ page, t }: { page: PageData; t: Translate }) {
  const has_meta = page.edit_url !== undefined || page.last_updated !== undefined;
  if (!has_meta && !page.previous && !page.next) return null;
  return (
    <footer className="site-foot">
      {has_meta && (
        <div className="site-meta">
          {page.edit_url && <a href={page.edit_url}><PencilIcon />{t("edit_page")}</a>}
          {page.last_updated && <span>{t("last_updated", { date: page.last_updated })}</span>}
        </div>
      )}
      {(page.previous || page.next) && (
        <nav className="site-pager" aria-label={`${t("previous")} / ${t("next")}`}>
          {page.previous && (
            <a className="site-pager-link previous" href={page.previous.href} rel="prev">
              <span className="site-pager-label">{t("previous")}</span>
              <span className="site-pager-title">{page.previous.label}</span>
            </a>
          )}
          {page.next && (
            <a className="site-pager-link next" href={page.next.href} rel="next">
              <span className="site-pager-label">{t("next")}</span>
              <span className="site-pager-title">{page.next.label}</span>
            </a>
          )}
        </nav>
      )}
    </footer>
  );
}

// The sidebar's links, groups folding open from the arrow before their label, the one holding the page you are on always open.
export function SiteNav({ items, current }: { items: NavItem[]; current: string }) {
  return <div className="site-nav">{items.map((item, index) => <NavEntry key={index} item={item} current={current} />)}</div>;
}

function holds(item: NavItem, href: string): boolean {
  return item.href === href || (item.kind === "group" && item.items.some((inner) => holds(inner, href)));
}

function NavEntry({ item, current }: { item: NavItem; current: string }) {
  if (item.kind === "link") {
    const here = item.href === current;
    return (
      <a className={here ? "tree-row active" : "tree-row"} href={item.href} aria-current={here ? "page" : undefined}>
        <span className="tree-label"><span>{item.label}</span></span>
      </a>
    );
  }
  return (
    <details className="site-nav-group" open={!item.collapsed || holds(item, current)}>
      <summary className="site-nav-heading">
        {item.href
          ? <a href={item.href} aria-current={item.href === current ? "page" : undefined}>{item.label}</a>
          : <span>{item.label}</span>}
      </summary>
      <div className="site-nav-items">{item.items.map((inner, index) => <NavEntry key={index} item={inner} current={current} />)}</div>
    </details>
  );
}

function LanguagePicker({ page, label }: { page: PageData; label: string }) {
  if (page.languages.length < 2) return null;
  return (
    <select
      className="site-language"
      aria-label={label}
      title={label}
      value={page.locale}
      onChange={(event) => {
        const language = page.languages.find((choice) => choice.key === event.target.value);
        if (language) location.assign(language.href);
      }}
    >
      {page.languages.map((language) => <option key={language.key} value={language.key} lang={language.lang}>{language.label}</option>)}
    </select>
  );
}

function SocialLinks({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="site-social">
      {links.map((link) => (
        <a key={link.href} href={link.href} className="site-social-link" title={link.label} aria-label={link.label}>
          <SocialGlyph icon={link.icon} />
        </a>
      ))}
    </div>
  );
}

const brand_paths: Partial<Record<SocialLink["icon"], string>> = {
  github: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  matrix: "M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.481.314.448.208.785.582 1.02 1.108.254-.374.6-.706 1.034-.992.434-.287.95-.43 1.546-.43.453 0 .872.056 1.26.167.388.11.716.286.993.53.276.245.489.559.646.951.152.392.23.863.23 1.417v5.728h-2.349V11.52c0-.286-.01-.559-.032-.812a1.755 1.755 0 0 0-.18-.66 1.106 1.106 0 0 0-.438-.448c-.194-.11-.457-.166-.785-.166-.332 0-.6.064-.803.189a1.38 1.38 0 0 0-.48.499 1.946 1.946 0 0 0-.231.696 5.56 5.56 0 0 0-.06.785v4.768h-2.35v-4.8c0-.254-.004-.503-.018-.752a2.074 2.074 0 0 0-.143-.688 1.052 1.052 0 0 0-.415-.503c-.194-.125-.476-.19-.854-.19-.111 0-.259.024-.439.074-.18.051-.36.143-.53.282-.171.138-.319.337-.439.595-.12.259-.18.6-.18 1.02v4.966H5.46V7.81zm15.693 15.64V.55H21.72V0H24v24h-2.28v-.55z",
};

function SocialGlyph({ icon }: { icon: SocialLink["icon"] }) {
  const path = brand_paths[icon];
  if (path) return <svg className="brand-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>;
  if (icon === "rss") {
    return <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></svg>;
  }
  return <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
}

function PencilIcon() {
  return <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
}

// What a missing page shows.
export function NotFound() {
  const page = use_site_page();
  return <p><a href={page.site.home}>{create_translator(page.ui)("go_home")}</a></p>;
}

// ── Pieces for a page's content ──────────────────────────────────────────────

// A titled card among others in a CardGrid.
export function Card({ title, children }: { title: string; children?: ReactNode }) {
  return <LayoutCard title={title} class_name="site-card">{children}</LayoutCard>;
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <Cards>{children}</Cards>;
}

// A card that is a link to another page, its address moved under the site's base.
export function LinkCard({ title, description, href }: { title: string; description?: string; href: string }) {
  const page = use_site_page();
  return (
    <LayoutCard title={title} href={with_base(page.base, href)} class_name="site-card link-card">
      {description && <p>{description}</p>}
    </LayoutCard>
  );
}

// A note set apart from the text around it: a note, a tip, a caution or a danger.
export function Aside({ type = "note", title, children }: { type?: "note" | "tip" | "caution" | "danger"; title?: string; children: ReactNode }) {
  return (
    <aside className="site-aside" data-type={type}>
      {title && <p className="site-aside-title">{title}</p>}
      {children}
    </aside>
  );
}
