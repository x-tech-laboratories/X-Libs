# X-App plan

X-Libs grows into X-App: the base every X-app is built on. Besides the shared modules and widgets X-Libs holds today,
it provides the general layout and runtime, which are the server, the desktop app's daemon and window, the phone host,
the sidebar Shell, the Settings and History pages, sign-in, sync, backups, plugins and notifications. An app adds its own
features to it and keeps nothing else. Every reusable UI element, widget and pattern an app has moves into X-App, and
every style into Halon, so no app carries a copy.

## Why

Five apps (X-Budget, X-Fitness, X-Media-Tracker, X-Dev, X-Control) carry the same 17 shell files, about 1,300 lines each:
`server/main.ts`, `server/app.ts`, `shared/store.ts`, `shared/bridge.ts`, `shared/backups.ts`, `shared/settings.ts`,
`shared/feature.ts`, `main/index.ts`, `preload/index.ts`, `web/main.tsx`, `web/App.tsx`, `web/api.ts`, `web/hosts/*` and
`web/settings/SettingsView.tsx`. They began as copies and now differ in most of their lines, so a fix in one app reaches
the others only by hand. Their configs, Nix files and CI workflows have drifted the same way.

A copied template does not fix this, since every update would conflict with the app's own edits. A base the apps depend
on does: a fix ships as one release that Dependabot brings to every app. One package rather than X-Libs plus a wrapper
means one home for every shared piece, no re-export layer and one release step.

## The rename

- The GitHub repo X-Libs is renamed X-App; GitHub redirects the old links and git remotes.
- The package publishes as `@x-tech-laboratories/x-app` from 0.98.0, from CI with provenance through npm's trusted
  publishing.
- Module paths stay the same: `@x-tech-laboratories/x-libs/web/react/shell` becomes
  `@x-tech-laboratories/x-app/web/react/shell`. An app switches with a search and replace of the package name, and its
  `x-libs-*` commands become `x-app-*`.
- `@x-tech-laboratories/x-libs` stays at 0.97.0, its last release. An app on it keeps working but takes nothing newer
  until it switches.
- The Android plugin and Java names (`XLibsBackupFolder`, `com.xtechlaboratories.xlibs`) and the names phones store
  data under keep their old spelling, since apps register them and installed phones hold data under them.
- The local folder, every repo's `AGENTS.md`, the site's pages and the session hooks and memories that name X-Libs
  follow the new name.

## What X-App adds

| Part | What it is |
| --- | --- |
| `app/define` | `define_app`: the app's name, port, features, pages, notifications and plugins in one object, and `define_feature` as `shared/feature.ts` has it in the apps. |
| `app/server` | `run_server(app)`: the Fastify server with sign-in, the call table, `/api/openapi.json`, `/api/mcp`, events, backups, notifications and plugins. |
| `app/daemon` | `run_daemon(app)`: the desktop app's local daemon on `local_daemon`, syncing through `sync_peer`. |
| `app/desktop`, `app/preload` | `run_desktop(app)` and `run_preload(app)`: the Electron main process as a portal onto a local or remote daemon through `daemon_router`, with the tray, the single instance and the window. |
| `app/web` | `render_app(app_pages)`: the page in its Shell, routed by the sidebar, with the Settings and History pages, `SyncButton`, and the hosts for the web, the desktop and Android. |
| `config/*` | Presets: `config/tsconfig/{base,node,web,tests}.json` to extend, and `web_vite_config`, `android_vite_config`, `desktop_vite_config` and `vitest_config`. |
| Nix flake `lib` | `x_app_package`, `x_app_desktop_package`, `x_app_module`, `x_app_shell` and `x_app_android_shell`, called from an app's `nix/flake.nix`. |
| `x-app-android` | A command that makes or updates the app's Capacitor project in `android/` from Capacitor's template with X-App's release settings and icons, so no app keeps the generated project. |
| CI actions | Composite actions `.github/actions/app-ci` (build, coverage floor, lint), `app-nix` (the Nix targets), `app-android` (the APK and its release) and `app-dependabot-auto-merge`, each one step of an app's `ci`, `nix` and auto-merge jobs, which keep their names. |
| `x-app-new` | A command that writes a new app's few files once. |

The headless agents and the site framework keep importing single modules; React, Electron, Fastify and the rest stay
optional peers, so they install none of what they do not use.

## What an app keeps

```
src/
  app.ts            define_app({ ... }): name, port, features, pages
  features/         one folder per feature: shared/ (tables, migrations, calls, api), web/ (pages, settings sections)
  server/main.ts    run_server(app)
  daemon/main.ts    run_daemon(app)          (desktop apps)
  main/index.ts     run_desktop(app)         (desktop apps)
  preload/index.ts  run_preload(app)         (desktop apps)
  web/main.tsx      render_app(app_pages)
  web/app.css       the app's own layout rules
tests/
docs/
nix/                flake.nix calling X-App's lib, flake.lock, shell.nix, module.nix only when it adds options
config/             the Vite, electron-vite and Vitest configs, and tsconfig.base.json and tsconfig.<target>.json extending X-App's presets
.github/            ci.yml and dependabot-auto-merge.yml calling X-App's workflows, dependabot.yml
config.example.json, package.json, tsconfig.json (references only), capacitor.config.json
```

The layout follows the Application Standard: the flake in `nix/` and the configs in `config/`.

## Customizing the base

An app changes the base through its app definition, never by editing a copy:

```ts
export const app = define_app({
  name: "X-Budget",
  slug: "x-budget",
  port: 7730,
  features: [budget_feature],
  notifications: [over_budget_notice],
  plugins: bundled_plugins,
  server_routes: (fastify) => { ... },
});

export const app_pages = define_pages(app, [
  { id: "plan", label: "Plan", view: () => <PlanView />, settings: plan_settings },
]);
```

- **Features** bring tables, migrations, calls, their `api_spec`, setting defaults and histories.
- **Pages** bring a sidebar entry, a view and settings sections.
- **Slots** for the layout's parts (`sidebar_foot`, `top_bar_tools`, extra settings sections, the empty state), each taking
  the app's component, or one that replaces the base's.
- **Hooks** on the server, the daemon and the desktop process (`server_routes`, `on_start`, `menu`, `tray`) for anything
  the definition does not cover.

When an app needs a hook that does not exist, X-App gains it; an app never forks a base file.

## Deduplicating as we go

- Each app's adoption pull request also moves every reusable widget, element and pattern it has into X-App, with tests
  and a README row, and every reusable style into Halon, then imports them. What only that app could ever use stays in
  the app.
- Before an app adds a widget, it checks X-App; a near match is extended in X-App rather than copied.
- The candidates already listed in `docs/TODO.md` move in when the app they come from adopts X-App, or sooner.
- Two apps holding the same piece is a bug: whoever finds it moves it, or lists it in `docs/TODO.md`.

## Steps

1. **Standard first.** A pull request to the Application Standard: X-App replaces X-Libs in "Shared code", the base app,
   presets and `x-app-new` join the layout and checklist, and the deduplication rule above. It lands once the user
   approves the wording.
2. **Rename.** The npm trusted publisher for the new name, the repo rename, the package name, the `x-app-*` commands, and
   the first `@x-tech-laboratories/x-app` release, 0.98.0, with no other change.
3. **Wait for the local-daemon move.** Another session is moving the desktop apps onto `daemon_router`, a
   `src/daemon/main.ts` and `sync_peer` (X-Budget first, then X-Media-Tracker). The base runtime builds on that layout,
   so X-Budget's extraction starts once that work merges. Steps 4 and 6 do not wait.
4. **Presets.** The tsconfig, Vite, electron-vite, Vitest and Capacitor presets, shipped in the package.
5. **The base runtime.** Characterization tests first, as the standard asks for an extraction: pin X-Budget's shell
   behaviour, move the shell into `app/*`, then run the same tests against X-App. Plugins, notifications and item search
   come from X-Fitness and X-Media-Tracker, which have them.
6. **Nix and workflows.** The flake `lib` functions from the five apps' near-identical `package.nix`,
   `desktop-package.nix` and `module.nix`, and the CI and auto-merge actions.
7. **Sample app and starter.** `x-app-new`, and an example app in `example/` with one item kind wired through every point
   of the standard's new-app checklist, which X-App's CI builds and tests on every pull request.
8. **Pilot on X-Budget.** Its shell replaced by X-App, its duplicates moved in, the `nix/` and `config/` layout, and
   TechNet's X-Budget input pointed at `?dir=nix`, coordinated with the other sessions before the switch.
9. **Rollout.** X-Fitness, X-Media-Tracker, X-Dev and X-Control, one pull request each, then the apps that differ more
   (X-Backups, X-Nix and X-Monitor with their agents, X-Tasks, X-Music, X-Stream, CODEX, X-Mail), each switching from
   `x-libs` to `x-app` as it moves.

## Open questions

- Settled: Vitest's `autoUpdate` raises a floor kept literal in the app's `vitest.config.ts` and merged into the preset
  with `mergeConfig`.
- How apps get X-App's flake updates: Dependabot's Nix support if it handles flake inputs, else a weekly
  `update-flake-lock` workflow.
