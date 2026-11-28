// Builds a static site for GitHub Pages from a folder of Markdown and MDX, on Vite: each page drawn to HTML in the
// X-apps' frame and picked up again in the browser, a Pagefind search index per language, a sitemap and a 404 page.
// The dev server draws each page as it is asked for and reloads it as its files change.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build, createServer, preview, type InlineConfig, type Manifest } from "vite";
import { text_direction } from "../i18n.ts";
import { read_content } from "./content.ts";
import { has_mermaid, mdx_plugin } from "./markdown.ts";
import {
  build_sidebar, extract_headings, neighbours, page_path, plan_routes, root_locale, site_locales, with_base,
  type NavItem, type PageData, type Route, type SiteConfig, type SourcePage,
} from "./model.ts";
import { messages_for } from "./ui_strings.ts";

// ── The project ──────────────────────────────────────────────────────────────

const config_names = ["site.config.ts", "site.config.mts", "site.config.js", "site.config.mjs"];

export interface SiteProject {
  root: string;
  config: SiteConfig;
  base: string;
  content_folder: string;
  out_folder: string;
  // Where the build writes the entries Vite starts from.
  work_folder: string;
}

export async function load_project(root: string): Promise<SiteProject> {
  const name = config_names.find((candidate) => existsSync(join(root, candidate)));
  if (!name) throw new Error(`No site.config.ts in ${root}.`);
  const config = ((await import(`${pathToFileURL(join(root, name)).href}?loaded=${Date.now()}`)) as { default: SiteConfig }).default;
  const base = `/${(config.base ?? "/").replace(/^\/|\/$/g, "")}/`.replace("//", "/");
  return { root, config, base, content_folder: resolve(root, config.content ?? "content"), out_folder: join(root, "dist"), work_folder: join(root, ".x-site") };
}

// ── The plan: every page, its address and the files it uses ──────────────────

export interface SitePlan {
  pages: SourcePage[];
  routes: Route[];
  // Files the pages show, such as the logo, by the address they are served at under the base.
  assets: Map<string, string>;
}

// Serves a file under "_x/" with a name that changes whenever its content does.
function asset_address(file: string, assets: Map<string, string>): string {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
  const address = `_x/${basename(file, extname(file))}-${digest}${extname(file)}`;
  assets.set(address, file);
  return address;
}

export function plan_site(project: SiteProject, with_dates = false): SitePlan {
  const locale_keys = Object.keys(site_locales(project.config));
  const pages = read_content(project.content_folder, locale_keys, with_dates);
  const assets = new Map<string, string>();
  if (project.config.logo) asset_address(resolve(project.root, project.config.logo), assets);
  for (const page of pages) {
    const image = page.frontmatter.hero?.image;
    if (image) asset_address(resolve(project.content_folder, dirname(page.id), image), assets);
  }
  return { pages, routes: plan_routes(pages, locale_keys), assets };
}

function default_sidebar(routes: Route[], locale: string, base: string): NavItem[] {
  return routes
    .filter((route) => route.locale === locale && !route.page.frontmatter.sidebar?.hidden)
    .map((route) => ({ kind: "link", label: route.page.frontmatter.sidebar?.label ?? route.page.frontmatter.title ?? route.slug, href: with_base(base, route.path) }));
}

function format_date(date: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(new Date(date));
}

// Everything one page carries; a route of null is the page that says a page is missing.
export function page_data(project: SiteProject, plan: SitePlan, route: Route | null, locale = route?.locale ?? root_locale): PageData {
  const { config, base } = project;
  const locales = site_locales(config);
  const default_locale = root_locale in locales ? root_locale : Object.keys(locales)[0];
  const language = locales[locale] ?? locales[default_locale];
  const ui = messages_for(language.lang, config.ui);
  const nav = config.sidebar ? build_sidebar(config.sidebar, plan.routes, locale, base) : default_sidebar(plan.routes, locale, base);
  const href = with_base(base, route ? route.path : "/404.html");
  const frontmatter = route?.page.frontmatter ?? {};
  const asset = (file: string) => with_base(base, `/${asset_address(file, plan.assets)}`);
  const hero = frontmatter.hero && {
    ...frontmatter.hero,
    image: frontmatter.hero.image && route ? asset(resolve(project.content_folder, dirname(route.page.id), frontmatter.hero.image)) : undefined,
  };
  const source_file = route && relative(project.root, join(project.content_folder, route.page.id)).split(sep).join("/");

  return {
    source: route?.page.id ?? "",
    path: route?.path ?? "/404.html",
    href,
    base,
    locale,
    lang: language.lang,
    dir: language.dir ?? text_direction(language.lang),
    title: route ? frontmatter.title ?? route.slug : ui.page_not_found,
    description: frontmatter.description,
    template: frontmatter.template ?? "doc",
    hero,
    headings: [],
    toc: route !== null && frontmatter.toc !== false,
    site: {
      title: config.title,
      logo: config.logo && asset(resolve(project.root, config.logo)),
      logo_replaces_title: config.logo_replaces_title,
      social: config.social ?? [],
      search: config.search !== false,
      home: with_base(base, page_path(locale, "")),
      theme_key: config.theme_key ?? "x-site-theme",
    },
    nav,
    ...(route ? neighbours(nav, href) : {}),
    edit_url: config.edit_link && source_file ? `${config.edit_link}${source_file}` : undefined,
    last_updated: config.last_updated && route?.page.last_updated ? format_date(route.page.last_updated, language.lang) : undefined,
    fallback_language: route?.is_fallback ? locales[default_locale].label : undefined,
    languages: Object.entries(locales).map(([key, other]) => ({ key, label: other.label, lang: other.lang, href: with_base(base, page_path(key, route?.slug ?? "")) })),
    ui,
  };
}

// ── Vite ─────────────────────────────────────────────────────────────────────

// The entries Vite starts from: the page modules by content file, the browser's entry with the site's stylesheets (and
// mermaid, when a page draws a diagram), and the server's; written only when they change, so the dev server does not
// reload for nothing.
export function write_entries(project: SiteProject, plan: SitePlan): void {
  mkdirSync(project.work_folder, { recursive: true });
  const from_work = (file: string) => {
    const path = relative(project.work_folder, file).split(sep).join("/");
    return path.startsWith(".") ? path : `./${path}`;
  };
  const page_lines = plan.pages.map((page) => `  ${JSON.stringify(page.id)}: () => import(${JSON.stringify(from_work(join(project.content_folder, page.id)))}),`);
  const css_lines = (project.config.css ?? []).map((sheet) => `import ${JSON.stringify(sheet.startsWith(".") ? from_work(resolve(project.root, sheet)) : sheet)};`);
  const draws_diagrams = plan.pages.some((page) => has_mermaid(readFileSync(join(project.content_folder, page.id), "utf8")));
  const start = draws_diagrams
    ? `import { mermaid_drawer } from "@x-tech-laboratories/x-app/web/site/mermaid";\nimport { pages } from "./pages.js";\n\nstart_site(pages, { draw_diagram: mermaid_drawer(() => import("mermaid")) });\n`
    : `import { pages } from "./pages.js";\n\nstart_site(pages);\n`;
  const files: Record<string, string> = {
    "pages.js": `export const pages = {\n${page_lines.join("\n")}\n};\n`,
    "client.js": `${css_lines.join("\n")}\nimport { start_site } from "@x-tech-laboratories/x-app/web/site/client";\n${start}`,
    "server.js": `export { load_content, render_content, render_page } from "@x-tech-laboratories/x-app/web/site/server";\nexport { pages } from "./pages.js";\n`,
    ".gitignore": "*\n",
  };
  for (const [name, text] of Object.entries(files)) {
    const file = join(project.work_folder, name);
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
  }
}

function vite_config(project: SiteProject): InlineConfig {
  return {
    root: project.root,
    base: project.base,
    configFile: false,
    publicDir: resolve(project.root, project.config.public ?? "public"),
    plugins: [mdx_plugin(project.base)],
    oxc: { jsx: { runtime: "automatic", importSource: "react" } },
    resolve: { dedupe: ["react", "react-dom"] },
    logLevel: "warn",
  };
}

interface ServerEntry {
  pages: Record<string, () => Promise<{ default: unknown }>>;
  load_content(pages: ServerEntry["pages"], source: string): Promise<unknown>;
  render_content(page: PageData, Content?: unknown): string;
  render_page(page: PageData, Content?: unknown): string;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function escape_html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Sets the reader's saved theme before the page is first drawn, so a dark page never flashes light.
function theme_script(key: string): string {
  return `<script>try{var t=localStorage.getItem(${JSON.stringify(key)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>`;
}

function head_tags(project: SiteProject, page: PageData, route: Route | null): string[] {
  const { config } = project;
  const site_address = config.site?.replace(/\/$/, "");
  const full_title = page.title === config.title ? page.title : `${page.title} | ${config.title}`;
  const description = page.description ?? config.description;
  const favicon = config.favicon && with_base(project.base, config.favicon);
  const tags = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escape_html(full_title)}</title>`,
    description && `<meta name="description" content="${escape_html(description)}">`,
    `<meta name="generator" content="X-App site">`,
    `<meta property="og:title" content="${escape_html(page.title)}">`,
    `<meta property="og:site_name" content="${escape_html(config.title)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="${escape_html(page.lang.replace("-", "_"))}">`,
    description && `<meta property="og:description" content="${escape_html(description)}">`,
    `<meta name="twitter:card" content="summary">`,
    favicon && `<link rel="icon" href="${escape_html(favicon)}"${favicon.endsWith(".svg") ? ` type="image/svg+xml"` : ""}>`,
    theme_script(page.site.theme_key),
  ];
  if (site_address && route) {
    tags.push(`<link rel="canonical" href="${escape_html(site_address + page.href)}">`, `<meta property="og:url" content="${escape_html(site_address + page.href)}">`);
    if (page.languages.length > 1) {
      for (const language of page.languages) tags.push(`<link rel="alternate" hreflang="${escape_html(language.lang)}" href="${escape_html(site_address + language.href)}">`);
      tags.push(`<link rel="alternate" hreflang="x-default" href="${escape_html(site_address + page.languages[0].href)}">`);
    }
    tags.push(`<link rel="sitemap" href="${escape_html(with_base(project.base, "/sitemap.xml"))}">`);
  }
  return tags.filter((tag): tag is string => typeof tag === "string" && tag !== "");
}

// The page as HTML: drawn once to read its headings, then again with its outline.
async function render_html(project: SiteProject, plan: SitePlan, entry: ServerEntry, route: Route | null, assets_tags: string[], locale?: string): Promise<string> {
  const page = page_data(project, plan, route, locale);
  const Content = await entry.load_content(entry.pages, page.source);
  page.headings = extract_headings(entry.render_content(page, Content));
  const body = entry.render_page(page, Content);
  const data = JSON.stringify(page).replace(/</g, "\\u003c");
  return [
    `<!doctype html>`,
    `<html lang="${escape_html(page.lang)}" dir="${page.dir}">`,
    `<head>`,
    ...head_tags(project, page, route),
    ...assets_tags,
    `</head>`,
    `<body>`,
    `<div id="root">${body}</div>`,
    `<script type="application/json" id="x-site-page">${data}</script>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}

// The built entry's script and stylesheets, from Vite's manifest.
function manifest_tags(project: SiteProject, manifest: Manifest): string[] {
  const key = relative(project.root, join(project.work_folder, "client.js")).split(sep).join("/");
  const entry = manifest[key];
  if (!entry) throw new Error(`The build has no ${key} in its manifest.`);
  const address = (file: string) => escape_html(with_base(project.base, `/${file}`));
  return [...(entry.css ?? []).map((file) => `<link rel="stylesheet" href="${address(file)}">`), `<script type="module" src="${address(entry.file)}"></script>`];
}

function sitemap(project: SiteProject, routes: Route[]): string | undefined {
  const site_address = project.config.site?.replace(/\/$/, "");
  if (!site_address) return undefined;
  const urls = routes.filter((route) => !route.is_fallback).map((route) => `  <url><loc>${escape_html(site_address + with_base(project.base, route.path))}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

// A page that sends the reader on to where the old address moved, kept out of search.
export function redirect_html(target: string): string {
  const address = escape_html(target);
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Moved</title>\n<meta name="robots" content="noindex">\n<link rel="canonical" href="${address}">\n<meta http-equiv="refresh" content="0; url=${address}">\n</head>\n<body>\n<p>This page moved to <a href="${address}">${address}</a>.</p>\n</body>\n</html>\n`;
}

function output_file(out_folder: string, path: string): string {
  return path.endsWith("/") ? join(out_folder, path, "index.html") : join(out_folder, path);
}

function write_file(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// ── Build ────────────────────────────────────────────────────────────────────

export async function build_site(root: string, log: (line: string) => void = console.info): Promise<void> {
  const project = await load_project(root);
  const plan = plan_site(project, project.config.last_updated === true);
  write_entries(project, plan);
  rmSync(project.out_folder, { recursive: true, force: true });

  const config = vite_config(project);
  // Rolldown's note on how long each plugin took is left out, as MDX's compiler is always most of a site's build.
  const quiet = { checks: { pluginTimings: false } };
  await build({ ...config, build: { outDir: project.out_folder, emptyOutDir: true, manifest: true, rolldownOptions: { ...quiet, input: join(project.work_folder, "client.js") } } });
  const server_folder = join(project.work_folder, "server");
  await build({ ...config, publicDir: false, build: { ssr: join(project.work_folder, "server.js"), outDir: server_folder, emptyOutDir: true, rolldownOptions: quiet } });

  const manifest = JSON.parse(readFileSync(join(project.out_folder, ".vite", "manifest.json"), "utf8")) as Manifest;
  rmSync(join(project.out_folder, ".vite"), { recursive: true, force: true });
  const entry = (await import(`${pathToFileURL(join(server_folder, "server.js")).href}?built=${Date.now()}`)) as ServerEntry;
  const tags = manifest_tags(project, manifest);

  for (const route of plan.routes) write_file(output_file(project.out_folder, route.path), await render_html(project, plan, entry, route, tags));
  write_file(join(project.out_folder, "404.html"), await render_html(project, plan, entry, null, tags));
  for (const [address, file] of plan.assets) {
    mkdirSync(dirname(join(project.out_folder, address)), { recursive: true });
    copyFileSync(file, join(project.out_folder, address));
  }
  const map = sitemap(project, plan.routes);
  if (map) write_file(join(project.out_folder, "sitemap.xml"), map);
  // GitHub Pages would hide the folders whose names start with an underscore, such as _x, without this.
  write_file(join(project.out_folder, ".nojekyll"), "");
  for (const [from, to] of Object.entries(project.config.redirects ?? {})) {
    write_file(output_file(project.out_folder, from), redirect_html(with_base(project.base, to)));
  }
  for (const extra of (await project.config.files?.()) ?? []) write_file(join(project.out_folder, extra.path), extra.content);
  log(`Wrote ${plan.routes.length} pages to ${relative(process.cwd(), project.out_folder) || "."}.`);

  if (project.config.search !== false) {
    const pagefind = await import("pagefind");
    const { index, errors } = await pagefind.createIndex({});
    if (!index) throw new Error(`Pagefind could not start: ${errors.join("; ")}`);
    const added = await index.addDirectory({ path: project.out_folder });
    if (added.errors.length > 0) throw new Error(`Pagefind could not index the site: ${added.errors.join("; ")}`);
    await index.writeFiles({ outputPath: join(project.out_folder, "pagefind") });
    await pagefind.close();
    log(`Indexed ${added.page_count} pages for search.`);
  }
}

// ── Dev server ───────────────────────────────────────────────────────────────

function send(response: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
  response.statusCode = status;
  response.setHeader("Content-Type", type);
  response.end(body);
}

const content_types: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".gif": "image/gif" };

export async function serve_site(root: string, port: number): Promise<void> {
  const project = await load_project(root);
  write_entries(project, plan_site(project));
  const server = await createServer({ ...vite_config(project), appType: "custom", server: { port }, logLevel: "info" });
  const client_tag = `<script type="module" src="${with_base(project.base, `/${relative(project.root, join(project.work_folder, "client.js")).split(sep).join("/")}`)}"></script>`;

  server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
    void (async () => {
      const address = decodeURIComponent((request.url ?? "/").split("?")[0]);
      if (!address.startsWith(project.base)) return next();
      const path = `/${address.slice(project.base.length)}`;
      const plan = plan_site(project);
      write_entries(project, plan);

      const route = plan.routes.find((candidate) => candidate.path === path);
      const moved_to = project.config.redirects?.[path];
      if (!route && moved_to !== undefined) {
        response.statusCode = 301;
        response.setHeader("Location", with_base(project.base, moved_to));
        return response.end();
      }
      if (!route) {
        if (!path.endsWith("/") && extname(path) === "" && plan.routes.some((candidate) => candidate.path === `${path}/`)) {
          response.statusCode = 301;
          response.setHeader("Location", `${address}/`);
          return response.end();
        }
        const asset = plan.assets.get(path.slice(1));
        if (asset) return send(response, 200, content_types[extname(asset)] ?? "application/octet-stream", readFileSync(asset));
        const extra = ((await project.config.files?.()) ?? []).find((file) => `/${file.path}` === path);
        if (extra) return send(response, 200, content_types[extname(extra.path)] ?? "text/plain", extra.content);
        if (extname(path) !== "" && extname(path) !== ".html") return next();
      }

      const entry = (await server.ssrLoadModule(join(project.work_folder, "server.js"))) as ServerEntry;
      const locale = route?.locale ?? Object.keys(site_locales(project.config)).find((key) => key !== root_locale && path.startsWith(`/${key}/`));
      const html = await render_html(project, plan, entry, route ?? null, [client_tag], locale);
      send(response, route ? 200 : 404, "text/html", await server.transformIndexHtml(address, html));
    })().catch((error: unknown) => {
      if (error instanceof Error) server.ssrFixStacktrace(error);
      next(error);
    });
  });

  await server.listen();
  server.printUrls();
}

export async function preview_site(root: string, port: number): Promise<void> {
  const project = await load_project(root);
  const server = await preview({ ...vite_config(project), build: { outDir: project.out_folder }, preview: { port }, logLevel: "info" });
  server.printUrls();
}
