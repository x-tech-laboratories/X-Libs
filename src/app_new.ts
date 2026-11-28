#!/usr/bin/env node
// The `x-app-new <X-Name>` command: a new X-app's few files, written once, laid out as the Application Standard asks
// and built on the base app. The app gets an example notes feature, its configs from X-App's presets, its Nix from
// X-App's lib and its CI from X-App's actions, so it runs on the web, the desktop and Android from the first commit.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// ── Options ──────────────────────────────────────────────────────────────────

export interface NewAppOptions {
  // The app's name, such as "X-Notes".
  name: string;
  // The web server's port; other devices reach a desktop's sync on the next one.
  port: number;
  desktop: boolean;
  android: boolean;
}

interface Names {
  name: string;
  slug: string;
  env_prefix: string;
  // The id's last part, such as "notes" in x-notes.
  short: string;
  // Android's application id, such as com.xtechlaboratories.xnotes.
  app_id: string;
}

export function names_of(name: string): Names {
  if (!/^X-[A-Z][A-Za-z0-9]*(-[A-Z][A-Za-z0-9]*)*$/.test(name)) throw new Error(`${name} is not an X-app name such as X-Notes or X-Media-Tracker`);
  const slug = name.toLowerCase();
  return { name, slug, env_prefix: slug.replaceAll("-", "_").toUpperCase(), short: slug.slice(2), app_id: `com.xtechlaboratories.${slug.replaceAll("-", "")}` };
}

// ── Versions ─────────────────────────────────────────────────────────────────

interface Manifest {
  version: string;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

const package_root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", package_root), "utf8")) as Manifest;

// The range X-App itself is tested with, or the newest of the ranges it accepts.
function version_of(name: string): string {
  const range = manifest.devDependencies[name] ?? manifest.peerDependencies[name];
  if (!range) throw new Error(`X-App names no version of ${name}`);
  return range.split("||").at(-1)!.trim();
}

// Packages X-App does not use itself, kept at the versions the X-apps run.
const own_versions: Record<string, string> = {
  "@capacitor/android": version_of("@capacitor/core"),
  "@capacitor/cli": version_of("@capacitor/core"),
  electron: "^45.5.0",
};

function versions(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, own_versions[name] ?? version_of(name)]));
}

// ── Files ────────────────────────────────────────────────────────────────────

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function package_json(names: Names, options: NewAppOptions): string {
  const prefix = names.env_prefix;
  const scripts: Record<string, string> = {
    "dev:server": `${prefix}_CONFIG=\${${prefix}_CONFIG:-config.example.json} ${prefix}_PASSWORD_HASH_FILE=\${${prefix}_PASSWORD_HASH_FILE:-dev-data/password.hash} node --watch src/server/main.ts`,
    "dev:web": "vite",
    ...(options.desktop ? { dev: `${prefix}_USER_DATA=\${${prefix}_USER_DATA:-dev-data/desktop} electron-vite dev` } : {}),
    build: "tsc -b && vite build",
    ...(options.desktop ? { "build:desktop": "tsc -b && electron-vite build" } : {}),
    ...(options.android ? { "build:android": "tsc -b && vite build -c vite.android.config.ts && cap sync android" } : {}),
    start: "NODE_ENV=production node src/server/main.ts",
    ...(options.desktop ? { "start:desktop": "electron-vite preview" } : {}),
    typecheck: "tsc -b",
    test: "vitest run",
    coverage: "vitest run --coverage",
    lint: "oxlint",
    "hash-password": "node src/server/hash_password.ts",
    icons: "x-app-icons",
  };
  const dependencies = [
    ...(options.android ? ["@capacitor/app", "@capacitor/core"] : []),
    "@fastify/cookie",
    "@fastify/cors",
    "@fastify/formbody",
    "@fastify/rate-limit",
    "@fastify/static",
    "@modelcontextprotocol/server",
    ...(options.android ? ["@sqlite.org/sqlite-wasm"] : []),
    "@x-tech-laboratories/halon",
    "fastify",
    "react",
    "react-dom",
  ];
  const dev_dependencies = [
    ...(options.android ? ["@capacitor/android", "@capacitor/cli"] : []),
    "@resvg/resvg-js",
    "@testing-library/dom",
    "@testing-library/react",
    "@types/node",
    "@types/react",
    "@types/react-dom",
    "@vitejs/plugin-react",
    "@vitest/coverage-v8",
    ...(options.desktop ? ["electron", "electron-vite"] : []),
    "jsdom",
    "oxlint",
    "typescript",
    "vite",
    "vitest",
  ];
  return json({
    name: names.slug,
    version: "0.1.0",
    private: true,
    description: `${names.name}: what it keeps, in one sentence`,
    license: "GPL-3.0-or-later",
    type: "module",
    ...(options.desktop ? { main: "out/main/index.js" } : {}),
    engines: { node: ">=24" },
    scripts,
    dependencies: { ...versions(dependencies), "@x-tech-laboratories/x-app": `^${manifest.version}` },
    devDependencies: versions(dev_dependencies),
  });
}

function app_ts(names: Names, options: NewAppOptions): string {
  return `// ${names.name} as the base app runs it: its name, ports and files, and its features.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_app, type AppMethodsOf } from "@x-tech-laboratories/x-app/app/define";

import package_json from "../package.json" with { type: "json" };
import { notes_feature } from "./shared/notes/store.ts";

// ── App ──────────────────────────────────────────────────────────────────────

export const app = define_app({
  id: "${names.slug}",
  name: "${names.name}",
  env_prefix: "${names.env_prefix}",
  version: package_json.version,
  summary: "Serves ${names.name} as a web app and syncs its devices.",
  instructions: "${names.name} holds notes. Start with list_notes.",
  data_name: "notes",
  database_file: "${names.short}.db",
  backup_prefix: "${names.short}",
  ports: { server: ${options.port}, peer: ${options.port + 1} },
  server_example: "https://${names.short}.example.org",
  features: [notes_feature],
});

// Every call the page can make, as it makes them.
export type AppMethods = AppMethodsOf<typeof app>;
`;
}

const notes_store_ts = `// Notes, each a title, as the example feature: its table, its calls and what each call does for other programs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_feature } from "@x-tech-laboratories/x-app/app/define";
import type { SqlDatabase } from "@x-tech-laboratories/x-app/sql";

// ── Notes ────────────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  title: string;
}

export const notes_feature = define_feature({
  id: "notes",
  // Each step runs once, in order; a released step is never edited, only followed by a new one.
  migrations: ["CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)"],
  tables: [{ name: "notes", key_columns: ["id"] }],
  methods: {
    list_notes: (database: SqlDatabase): Note[] => database.prepare("SELECT id, title FROM notes ORDER BY title").all() as unknown as Note[],
    add_note: (database: SqlDatabase, title: string): string => {
      const id = crypto.randomUUID();
      database.prepare("INSERT INTO notes (id, title) VALUES (?, ?)").run(id, title.trim() || "Note");
      return id;
    },
    remove_note: (database: SqlDatabase, id: string): void => void database.prepare("DELETE FROM notes WHERE id = ?").run(id),
  },
  api: {
    list_notes: { description: "Every note, by title.", params: [] },
    add_note: { description: "Adds a note and gives its id.", params: [{ name: "title", schema: { type: "string", description: "The note's title." } }] },
    remove_note: { description: "Removes a note.", params: [{ name: "id", schema: { type: "string", description: "The note's id, as list_notes gives it." } }] },
  },
});
`;

function entry_points(names: Names): Record<string, string> {
  return {
    "src/server/main.ts": `// Starts the ${names.name} web server on the database the config names.

import { run_server } from "@x-tech-laboratories/x-app/app/server";

import { app } from "../app.ts";

await run_server(app, { web_folder: new URL("../../out/web", import.meta.url) });
`,
    "src/server/hash_password.ts": `// Adds or replaces a user's line in the accounts file ${names.env_prefix}_PASSWORD_HASH_FILE names, asking at a terminal so the
// password never lands in argv or shell history.

import { hash_password_command } from "@x-tech-laboratories/x-app/server/hash_password";

await hash_password_command("${names.env_prefix}_PASSWORD_HASH_FILE");
`,
  };
}

function desktop_entry_points(names: Names): Record<string, string> {
  return {
    "src/daemon/main.ts": `// Starts the desktop app's daemon on the database and socket the window names, and ends the process once it stops.

import { run_daemon } from "@x-tech-laboratories/x-app/app/daemon";

import { app } from "../app.ts";

await run_daemon(app);
`,
    "src/main/index.ts": `// The desktop app's window: Electron's main process, which shows ${names.name} and leaves the work to this computer's daemon
// or to the ${names.name} server chosen under Settings → Connections.

import * as electron from "electron";
import { run_desktop } from "@x-tech-laboratories/x-app/app/desktop";

import { app } from "../app.ts";

run_desktop(app, electron, { main_dir: import.meta.dirname });
`,
    "src/preload/index.ts": `// Gives the desktop app's page its calls to the main process, under the names the page looks for.

import { contextBridge, ipcRenderer } from "electron";
import { run_preload } from "@x-tech-laboratories/x-app/app/preload";

import { app } from "../app.ts";

run_preload(app, { contextBridge, ipcRenderer });
`,
  };
}

function web_files(names: Names): Record<string, string> {
  return {
    "src/web/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <title>${names.name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
`,
    "src/web/main.tsx": `// Starts the page on whichever host it runs: the desktop app, the phone app or a browser.

import "./app.css";
import { render_app } from "@x-tech-laboratories/x-app/app/web/app_page";

import { app } from "../app.ts";
import { pages } from "./pages.tsx";

void render_app({ app, pages });
`,
    "src/web/api.ts": `// The page's calls typed with ${names.name}'s own, on whichever host the base app started the page.

import { page_hooks } from "@x-tech-laboratories/x-app/app/web/page";

import type { AppMethods } from "../app.ts";

export const { calls, page, use_data, use_settings } = page_hooks<AppMethods>();
`,
    "src/web/pages.tsx": `// The sections of the app, each a page with its own settings, in the order the sidebar lists them.

import type { AppPage } from "@x-tech-laboratories/x-app/app/web/app_page";

import { NotesView } from "./notes/NotesView.tsx";

export const pages: AppPage[] = [{ id: "notes", label: "Notes", view: () => <NotesView /> }];
`,
    "src/web/notes/NotesView.tsx": `// The notes, and a field to add one.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useState } from "react";
import { PageHeading } from "@x-tech-laboratories/x-app/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-app/web/react/states";
import { attempt } from "@x-tech-laboratories/x-app/web/react/toasts";

import { calls, use_data } from "../api.ts";

// ── Notes ────────────────────────────────────────────────────────────────────

export function NotesView() {
  const notes = use_data((api) => api.list_notes());
  const [title, set_title] = useState("");

  return (
    <>
      <PageHeading title="Notes" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          attempt(calls().add_note(title).then(() => set_title("")));
        }}
      >
        <input aria-label="New note" value={title} onChange={(event) => set_title(event.currentTarget.value)} />
        <button type="submit">Add note</button>
      </form>
      <Loaded resource={notes}>{(list) => <ul>{list.map((note) => <li key={note.id}>{note.title}</li>)}</ul>}</Loaded>
    </>
  );
}
`,
    "src/web/app.css": "/* Layout only; every colour, size and widget look comes from Halon's tokens and stylesheet. */\n",
  };
}

function config_files(names: Names, options: NewAppOptions): Record<string, string> {
  const preset = "@x-tech-laboratories/x-app/config/tsconfig";
  const node_include = ["../src/app.ts", "../src/server", ...(options.desktop ? ["../src/daemon", "../src/main", "../src/preload"] : []), "../src/shared", "../vite.config.ts", ...(options.android ? ["../vite.android.config.ts"] : []), ...(options.desktop ? ["../electron.vite.config.ts"] : []), "../vitest.config.ts"];
  const target = (name: string, include: string[]) =>
    json({ extends: ["./tsconfig.base.json", `${preset}/${name}.json`], include, compilerOptions: { tsBuildInfoFile: `../node_modules/.tmp/tsconfig.${name}.tsbuildinfo` } });
  return {
    "tsconfig.json": json({ files: [], references: ["node", "web", "tests"].map((name) => ({ path: `./tsconfig/tsconfig.${name}.json` })) }),
    "tsconfig/tsconfig.base.json": json({ extends: `${preset}/base.json` }),
    "tsconfig/tsconfig.node.json": target("node", node_include),
    "tsconfig/tsconfig.web.json": target("web", ["../src/app.ts", "../src/web", "../src/shared"]),
    "tsconfig/tsconfig.tests.json": target("tests", ["../tests", "../src"]),
    "vite.config.ts": `// The page for a browser, from X-App's preset.

import { defineConfig } from "vite";
import { web_vite_config } from "@x-tech-laboratories/x-app/config/vite";

export default defineConfig(web_vite_config({ port: ${options.port} }));
`,
    "vitest.config.ts": `// X-App's test preset, with this app's coverage floor, which only rises.

import { defineConfig, mergeConfig } from "vitest/config";
import { vitest_config } from "@x-tech-laboratories/x-app/config/vitest";

export default mergeConfig(
  vitest_config(),
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          autoUpdate: (new_threshold) => Math.floor(new_threshold),
          lines: 0,
          statements: 0,
          functions: 0,
          branches: 0,
        },
      },
    },
  }),
);
`,
    ...(options.desktop
      ? {
          "electron.vite.config.ts": `// The desktop app's window, daemon, preload and page, from X-App's preset.

import { defineConfig } from "electron-vite";
import { desktop_vite_config } from "@x-tech-laboratories/x-app/config/electron_vite";

export default defineConfig(desktop_vite_config());
`,
        }
      : {}),
    ...(options.android
      ? {
          "vite.android.config.ts": `// The page for the Capacitor app, which keeps its database on the phone, from X-App's preset.

import { defineConfig } from "vite";
import { android_vite_config } from "@x-tech-laboratories/x-app/config/vite";

export default defineConfig(android_vite_config());
`,
          "capacitor.config.json": json({ appId: names.app_id, appName: names.name, webDir: "out/android", android: { allowMixedContent: true }, plugins: { CapacitorHttp: { enabled: true } } }),
        }
      : {}),
    "config.example.json": json({ database: `dev-data/server/${names.short}.db`, backups_folder: "dev-data/server/backups" }),
    ".gitignore": [".claude/", "node_modules", "out/", "dist/", "result", "result-*", "*.tsbuildinfo", "dev-data/", "coverage/", ""].join("\n"),
  };
}

function nix_files(names: Names, options: NewAppOptions): Record<string, string> {
  return {
    "nix/app.nix": `# ${names.name} as X-App's Nix lib builds it; the flake and shell.nix both read it.
{
  name = "${names.slug}";
  display_name = "${names.name}";
  env_prefix = "${names.env_prefix}";
  src = ../.;
  description = "${names.name}: what it keeps, synced through your own server";
  module_description = "a web app that its devices sync with";
  desktop_comment = "${names.name}";
  port = ${options.port};
  database_file = "${names.short}.db";
  sync_example = "https://${names.short}.example.org/api/";
  desktop = ${options.desktop};
}
`,
    "nix/flake.nix": `{
  description = "${names.name}";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    x-app.url = "github:x-tech-laboratories/X-App";
  };

  outputs = { self, nixpkgs, flake-utils, x-app }:
    let
      app = import ./app.nix;
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        packages.default = x-app.lib.package pkgs app;${options.desktop ? "\n        packages.desktop = x-app.lib.desktop_package pkgs app;" : ""}
        devShells.default = x-app.lib.shell pkgs app;${options.android ? "\n        devShells.android = x-app.lib.android_shell nixpkgs system;" : ""}
      }
    ) // {
      nixosModules.default = x-app.lib.module self app;
    };
}
`,
    "nix/shell.nix": `# The flake's dev shell for nix-shell, with X-App's lib at the version flake.lock pins.
{ pkgs ? import <nixpkgs> { } }:

let
  pinned = (builtins.fromJSON (builtins.readFile ./flake.lock)).nodes.x-app.locked;
  x_app = builtins.fetchTarball "https://github.com/\${pinned.owner}/\${pinned.repo}/archive/\${pinned.rev}.tar.gz";
in
(import "\${x_app}/nix/lib.nix").shell pkgs (import ./app.nix)
`,
  };
}

function github_files(options: NewAppOptions): Record<string, string> {
  return {
    ".github/workflows/ci.yml": `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: x-tech-laboratories/X-App/.github/actions/app-ci@main

  # Builds the package TechNet deploys${options.desktop ? " and the desktop app" : ""}, so a dependency bump that breaks either fails here.
  nix:
    runs-on: ubuntu-latest
    steps:
      - uses: x-tech-laboratories/X-App/.github/actions/app-nix@main
        with:
          targets: ./nix#default${options.desktop ? " ./nix#desktop" : ""}
`,
    ".github/workflows/dependabot-auto-merge.yml": `name: Dependabot auto-merge

on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: x-tech-laboratories/X-App/.github/actions/app-dependabot-auto-merge@main
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
`,
    ".github/dependabot.yml": `version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      # X-App and Halon in one pull request, so the Halon peer of X-App matches.
      x-tech:
        patterns: ["@x-tech-laboratories/*"]
      # Third-party patch and minor updates in one pull request; a major update comes on its own.
      npm:
        patterns: ["*"]
        exclude-patterns: ["@x-tech-laboratories/*"]
        update-types: [minor, patch]
    ignore:
      # The types follow the Node runtime, 24 in CI and the flakes, so their majors move with it by hand.
      - dependency-name: "@types/node"
        update-types: ["version-update:semver-major"]
    # Our own releases skip the default 3-day cooldown.
    cooldown:
      exclude: ["@x-tech-laboratories/*"]
`,
  };
}

function doc_files(names: Names, options: NewAppOptions): Record<string, string> {
  const agents = `# Instructions for AI agents

${names.name} runs on the X-App base app: \`src/app.ts\` describes it with \`define_app\`, and each entry point is one call
into X-App. Its own code is its features (\`src/shared/<feature>/\`) and pages (\`src/web/\`).

## X-Tech standards

- Follow the [Application Standard](https://x-tech-laboratories.github.io/standards/application/) and the
  [Design Guidelines](https://x-tech-laboratories.github.io/standards/design/), whose source is \`src/content/docs/standards/\`
  in [x-tech-laboratories.github.io](https://github.com/x-tech-laboratories/x-tech-laboratories.github.io). Ask before
  changing either, since a change applies to every X-app.
- Use [X-App](https://github.com/x-tech-laboratories/X-App) and Halon ([X-Themes](https://github.com/x-tech-laboratories/X-Themes))
  before writing your own code: check the module table in the X-App README first.
- A feature another app could use belongs in X-App, or Halon for styling, with tests and a README row. A change the
  base needs goes into X-App, never into a copy here.
`;
  return {
    "README.md": `# ${names.name}

${names.name}: what it keeps, in one sentence. It runs in a browser against its own server${options.desktop ? ", as a desktop app" : ""}${options.android ? ", and on Android" : ""}, all syncing
through the server, on the [X-App](https://github.com/x-tech-laboratories/X-App) base app.

## Development

\`\`\`
nix-shell nix/shell.nix   # or nix develop ./nix
npm install
npm run dev:server        # the server, against config.example.json
npm run dev:web           # the page, in a browser${options.desktop ? "\nnpm run dev               # the desktop app" : ""}
npm test
\`\`\`

## License

GPL-3.0-or-later.
`,
    "AGENTS.md": agents,
    "CLAUDE.md": agents,
  };
}

const test_ts = `import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";

describe("notes", () => {
  it("adds a note and lists it", () => {
    const database = new DatabaseSync(":memory:");
    app.open_store(database);
    const methods = app.bind_methods(() => database, () => undefined);

    const id = methods.add_note("Groceries");

    expect(methods.list_notes()).toEqual([{ id, title: "Groceries" }]);
  });
});
`;

// The X-Tech hexagon with a plain mark, to be redrawn as the app's own glyph.
const icon_svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 3 57 17.5v29L32 61 7 46.5v-29z" fill="#2563eb" />
  <path d="M22 22h20v4H22zm0 8h20v4H22zm0 8h14v4H22z" fill="#fff" />
</svg>
`;

// Every file the app starts with, by path.
export function new_app_files(options: NewAppOptions): Record<string, string> {
  const names = names_of(options.name);
  return {
    "package.json": package_json(names, options),
    "src/app.ts": app_ts(names, options),
    "src/shared/notes/store.ts": notes_store_ts,
    ...entry_points(names),
    ...(options.desktop ? desktop_entry_points(names) : {}),
    ...web_files(names),
    "src/web/public/icon.svg": icon_svg,
    "resources/icon.svg": icon_svg,
    "tests/app.test.ts": test_ts,
    ...config_files(names, options),
    ...nix_files(names, options),
    ...github_files(options),
    ...doc_files(names, options),
    LICENSE: readFileSync(new URL("LICENSE", package_root), "utf8"),
  };
}

// Writes the app into a folder that is empty or not there yet, and gives the paths written.
export function write_new_app(folder: string, options: NewAppOptions): string[] {
  if (existsSync(join(folder, "package.json"))) throw new Error(`${folder} already holds an app`);
  const written: string[] = [];
  for (const [path, text] of Object.entries(new_app_files(options))) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(target);
  }
  return written;
}

// ── Command ──────────────────────────────────────────────────────────────────

const usage = `Usage: x-app-new <X-Name> [--port <port>] [--folder <folder>] [--no-desktop] [--no-android]

Writes a new X-app built on X-App into the folder, ./<X-Name> unless given, with an example notes feature.`;

export function parse_new_app_args(args: string[]): { folder: string; options: NewAppOptions } {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { port: { type: "string" }, folder: { type: "string" }, "no-desktop": { type: "boolean" }, "no-android": { type: "boolean" } },
  });
  const [name] = positionals;
  if (!name || positionals.length > 1) throw new Error(usage);
  const port = Number(values.port ?? 7800);
  if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error(`not a port: ${values.port}`);
  return { folder: resolve(values.folder ?? name), options: { name, port, desktop: !values["no-desktop"], android: !values["no-android"] } };
}

if (import.meta.main) {
  try {
    const { folder, options } = parse_new_app_args(process.argv.slice(2));
    write_new_app(folder, options);
    console.info(`Wrote ${options.name} into ${folder}. Next:
  cd ${folder} && git init && npm install
  nix flake lock ./nix
  npm run icons${options.android ? "\n  npx cap add android" : ""}
  npm test`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
