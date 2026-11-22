# X-Libs and Halon to-do

Work for a later pass, written down so another agent can pick it up. Check each item against current `main` first, since the libraries have moved on since this was logged.

## X-Tasks look differences (Halon and X-Libs)

Found when Halon 0.5 and X-Libs 0.11 were compared with the X-Tasks look at 9d524aa.

1. PageHeading stacks the title, the "N left" count and the actions in three rows instead of one baseline row. Fix in X-Libs.
2. Field labels were uppercase, 11px and tracked. They are now sentence case. Restore the caps in Halon.
3. Table header column separators are gone. Restore them in Halon.
4. The brand moved into the top bar and search no longer spans the full width. Fix in the X-Libs Shell; it affects every app.
5. The tree toggle glyph is a down triangle instead of the old chevron.

## Candidates for the next X-Libs and Halon round

- From X-Music: the page-view tabs clipped under the header on first open.
- For X-Tasks: move its phone notices (`src/web/android/phone_notices.ts`) onto `phone_notices` and the daemon's due reminders (`src/daemon/notices.ts`) onto `agent/scheduled_notices`.
- From CODEX: Electron sidecar (autostart, starting the daemon and the tray are in `autostart`, `local_daemon` and `electron/tray`; CODEX can move onto them); reducer/effects store; NumberField; caption heading; the data-empty pattern; force_graph wrapper; StepLog; a scrollIntoView stub; adopt use_shortcuts; a yes/no-with-note dialog.
- From X-Stream: metadata cache with TTL, refresher, image-to-data-URI, parseViewCount and parseRelativeAge, loading overlay, sidebar entity list, threaded comments.
- Move X-Backups' map (`src/web/views/map.tsx`) onto `web/react/flow_map`, whose drawing, ordering and pan and zoom it was taken from, and drop its own `.flow-map` and `map-*` rules from `src/web/app.css` for Halon's.
- From X-Fitness: categories as rows with a parent (`src/shared/category_tree.ts`): paths read by `path_names`, an item's ids in a subtree, finding or making a category by a "/" path, merging a renamed category into a same-named sibling, and a migration turning "/" path categories into rows keyed by their old paths; with the folder-style browser of `src/web/categories.tsx` (`Crumbs` back up, a chip per subcategory), as a parent-linked side of `categories`.
- From X-Fitness and X-Stream: one item's versions in a dialog and the latest changes to every item, each restorable, on `history_methods` (X-Fitness `src/web/history/HistoryView.tsx`, X-Stream `src/components/PlaylistHistory/`).
- From X-Tasks: a rule builder of conditions matching all or any, with groups nesting to any depth (`src/web/FilterDialog.tsx` `ConditionList` and `ConditionRow`, matched by `rule_matches` in `src/web/rules.ts`), as a generic `web/react` widget taking the condition kinds and their controls from the app.
- From X-Fitness's shared UI pieces (2026-11-14):
  - `UnitNumber` (`src/web/unit_field.tsx`): a `NumberField` showing a stored value in display units and handing back the stored value, empty at 0, in a `FormRow`, a `SettingRow` or bare.
  - `attempt`, `succeeds` and `show_error` (`src/web/api.ts`): run a call and show its failure as a toast, for `web/react/toasts`.
  - `row_actions_column` and `confirm_delete` (`src/web/rows.tsx`): a table's Edit, History and Delete column and the delete confirmation.
  - `AddNameForm`, `RenameField` and `use_rename` (`src/web/forms.tsx`), and the `FormButtons` and `DialogButtons` pairs.
  - `LookupPanel` (`src/web/lookup.tsx`): a search box, its results list and its error line for an online lookup.
  - `use_day` and `DayStepper` (`src/web/day.tsx`): a day kept in state or the session, with the `PeriodStepper` for it.
  - `epoch_of` and `day_of` (`src/web/dates.ts`): a chart's epoch of a day in UTC and back, for `dates`.
  - `CategorizedSelect`, `use_category_view` and `GroupToggle` (`src/web/categories.tsx`), once adapted from the app's id tree to "/" paths.
  - A what-if field's "Changed" badge with its own Reset (`src/web/calculators/CalculateTab.tsx`), and a read-only setting value that follows another page, with a link (`src/web/diet/DietSettings.tsx`).
  - For `DataTable`: choosing the columns that hide on a phone and a compact one-line phone row (X-Fitness does it in `src/web/body/body.css`), the grouping button overlapping the first card on a phone, and the "Actions" label repeated on every phone card.
  - For Halon: the layout classes `.inline-row`, `.spread-row`, `.result-list`, `.result-row` and `.close-list` of X-Fitness's `src/web/app.css`.
  - `PeriodStepper` shows "Today" twice on the current day, as its button and as its label.
  - A button that opens a `Popover` and closes it on a second click (X-Fitness `SkinfoldWhere` in `src/web/body/SkinfoldDiagram.tsx`); today the click that closes the popover opens it again unless the app guards it.
- For X-Tasks: move its hand-rolled MCP endpoint (`src/main/mcp_server.ts`) onto `electron/mcp` and `LocalMcpSettings`, with its tools described as an `api_spec`.
- For X-Tasks: move its tray (`src/main/tray.ts`, `tray_menu.ts`) onto `electron/tray` and its `register_bridge_calls` (`src/server/app.ts`) onto `server/call_table`.
- From X-Backups: fall back to a column id for an empty column label in web/tables.ts (DataTable throws on an empty label); Suggestions empty slot and source_delay_ms; FollowingOutput aria-label and tabIndex; guard extra paths such as /metrics; state badges, DurationBar and the live.ts client; an `extra` hook on register_error_replies.
- From X-Media-Tracker: a TMDB client for any app showing film or TV details, such as X-Stream (`src/shared/library/tmdb.ts`); filter counts where each choice is narrowed by every other filter but its own, to pair with X-Music's facet pane (`facet_counts` in `src/shared/library/model.ts`); reading a picked file's text and saving text as a download, which X-Fitness hand-rolls too; `pick_list_dialog` that can untick a list and show lists under group headings, for collections; running an async step over a list a few at a time (`refresh_library` in `src/shared/library/store.ts`), as a `map_limited(items, limit, step)` beside X-Monitor's `Semaphore`.
- From X-Media-Tracker's sync (2026-11-13): a relay mode for `sync_engine` and `sync_client`, so one server can be a device of another and pass on changes it took from its own devices; `collect_unpushed_changes` sends only the changes stamped with the device's own site, so today a server syncing to a server forwards only its own edits.
- From X-Media-Tracker's Books (2026-11-15):
  - Move X-Fitness's hand-rolled `parse_csv` (`src/shared/workouts/liftosaur.ts`) and X-Tasks' `csv_field` onto the `csv` module.
  - Half stars for `web/react/rating` (a `step` of 0.5), so a 1 to 10 rating can show as five stars, as Hardcover and StoryGraph do; the Books page uses ten whole stars until then.
  - A `Shell` sidebar of sections, each a heading over its pages in a group named by it and ruled off from the next (`src/web/Sidebar.tsx`, `.sidebar-section` in `src/web/app.css`), to sit beside the folding sections of the `Shell`.
  - Book catalogue clients for any app that shows books: BookBrainz, Open Library and Hardcover answering in one shape and joined into one book (`src/shared/books/{bookbrainz,openlibrary,hardcover,catalog}.ts`).
- From X-Media-Tracker's Games (2026-11-17):
  - A secret setting row: a key or token typed in, saved with a button, never shown again once set, only said to be set, with Remove (`SecretRow` in `src/web/settings/rows.tsx`), beside `SettingRow`.
  - `use_refresh`: following a job that runs on its own wherever the data is kept by asking its progress each second, including one already running when the page opens, and toasting its report when it ends (`src/web/refresh.ts`), for any app with a long background refresh.
  - Paced requests for services that ask for one request at a time or a gap between them, waiting out a 429's `Retry-After` (the Wikidata and MobyGames clients in `src/shared/games/`), beside X-Monitor's `Semaphore`.
  - Game catalogue clients for any app that shows games: RAWG, MobyGames, Giant Bomb, Wikidata and Steam answering in one shape, joined into one game, with Wikidata linking each catalogue's ids (`src/shared/games/{rawg,mobygames,giantbomb,wikidata,steam,catalog}.ts`).
- From X-Tasks' worklog (2026-11-17): a `week` period for `PeriodStepper` (X-Tasks steps weeks with its own buttons in `src/web/WorklogPage.tsx`); a desktop `save_text_file` that asks where through Electron's Save dialog, with a browser download and a phone's copy beside it (`src/main/index.ts`, `src/web/web_bridge.ts`), since a blob download in Electron saves to Downloads without asking; and its RFC 4180 `csv_field` for the `csv` candidate below.
- From X-Tasks' timer (2026-11-17): stretches of work with a start and an optional end, the open one counting up to now, totalled per local day with a stretch past midnight split between the days (`seconds_by_day`, `running_entry` and `time_spent_label` in `src/shared/time_tracking.ts`), and a running-timer chip for the `Shell`'s tools (`TimerBar` in `src/web/TimeTracking.tsx`), as a `time_tracking` module.
- From X-Media-Tracker's merge window (2026-11-18, `src/web/merging.tsx`): `MergeGrid` options for a field the survivor leaves empty to default to the first record that has it, for `combine` to be offered without being the default (catalogues name the same genres differently), and for records that can lend values but not survive (catalogue answers beside tracked rows); and a `MergeWindow` over it with fields that write several columns, such as a book's authors with their ids, and a second grid for the records' own data.
- From X-Media-Tracker's settings (2026-11-19, `SourceRow` in `src/web/settings/rows.tsx`): a settings row with a name, a short status and an Open button whose dialog holds that group's settings, for the Application Standard's rule that a cluttered settings section moves each group into its own dialog; and a `plugin_id` prop on `PluginSettings` and `PluginSlot` to draw one plugin alone, replacing its `only_plugin` host filter in `src/web/sources/SourceSettings.tsx`.
- A shared History page or dialog and a helper telling what changed between two snapshots, since X-Media-Tracker, X-Tasks and X-Music each build their own.
- From X-Monitor: a log search table over entries from many hosts (sort, filter, group by a field with collapsible parent rows, a priority badge per entry) with a search bar of time range, priority, unit and text.
- From X-Monitor's TypeScript port (`worktree-ts-port`), too big or app-shaped to move in the first round:
  - The pooled SSH transport with trust on first use, `src/core/connectors/ssh_connector.ts`: `SSHConnection` (one connection per host kept and reused, `execute(command, timeout) -> [exit_code, stdout, stderr]`), `TofuVerifier` (a host key trusted on first use and refused once it changes), `Semaphore` and `measure_channel_wait`, as an `agent/ssh` module beside `agent/programs`.
  - The batched SQLite writer in `src/core/database/sqlite_persistence.ts` (`SqlitePersistence`: writes buffered and flushed in one transaction every few seconds, pruning and downsampling by age) and its `distinct_keys`, the distinct keys of a large table by skip-scan rather than a full scan; a `batched_writer(database, { flush_every_seconds })` with `write(table, rows)`, `flush()` and `close()` for `sql`.
  - `monitor_graph` (`src/core/coordination/monitor_graph.ts`): a DAG of items defined once and linked under other parents with labels of their own, `iter_monitors`, `parent_ids`, `resolve_links`, `child_label`, `is_link`; the server's copy is `src/server/monitor_tree.ts`.
  - Borg readers shared with X-Backups: `src/monitors/borg/{parsing,checks,shell}.ts` against X-Backups `src/server/borg/`: `parse_borg_info`, `parse_archive_list`, `check_freshness`, `borg_env(passphrase_command)` and the shell builders, one `agent/borg` module both apps call.
  - The OCI registry digest lookup, `src/monitors/containers/registry.ts`: `parse_reference(text) -> ImageRef`, `RegistryAuth`, `parse_challenge` for the bearer-token challenge, `remote_digest(fetch, ref, auth, timeout)` and `check_images(fetch, refs, auths)`, as `server/oci_registry`.
  - `src/monitors/base/metric_family.ts` (metric names grouped into families by a shared stem), beside `server/prometheus`.
  - The detached-job poll step repeated in attic_push, vuln_scan, nixos_upgrade and borg: `poll_detached_job(jobs, job, { on_output, on_done })` reading new output since the last sequence and finishing the job by exit code.
  - The small XML reader in vuln_scan (`src/monitors/vuln_scan.ts`): `parse_xml(text) -> { name, attributes, children, text }` for nmap's output, without a dependency.
  - `close_matches` and `similarity_ratio` (difflib's get_close_matches) and `deep_equal` (Python's == on JSON values) in `src/core/python.ts`, as more of `python_text`.
  - A strict `python_format` raising Python's KeyError, IndexError and single-brace errors in its own words, as `src/monitors/uptime.ts` has, behind an option of `python_text`'s.
  - Cache-busting reloads of plugin folders (`src/core/coordination/plugin_loader.ts`): re-import a changed plugin module under a new query string, as an option of `load_plugin_folder`.
- Left out of token scopes (2026-11-20): a scope is always read-only plus its calls, so there is no scope that may not read; tokens declared in an app's config (`server/declared_tokens`) take a role and read-only, not a token scope; and the local MCP endpoint's token is all or nothing, with no scope of its own.
- From X-Tasks' checklist page (2026-11-21): rows that edit like a checklist in a note, as a `web/react` widget over `web/tree` rows. Each title is a field that grows as it wraps; Enter adds a row below beside it, Tab nests under the row above and Shift+Tab unnests (`move_for_drop`), Backspace on an empty row deletes it, Up and Down walk the open rows, a new row left blank is dropped, and the caret follows a row that draws anew after a move (`src/web/ChecklistPage.tsx`, `ChecklistTitle` and `place_rows`). The app would keep its own rows' checkbox and buttons around the title.
- A widget gallery: a demo page that shows the `web/react` widgets (shell, tables, dialogs, settings panels, tiles) on Halon, with example data, so X-Libs has a screenshot for the Projects page of x-tech-laboratories.github.io (`src/content/docs/projects.mdx`) and a place to see a widget before using it. The `x-libs-site` generator could publish it as X-Libs' own Pages site.

## Settings, History and Users in Settings (Application Standard, 2026-11-13)

The standard now gives every app a Settings page (`SettingsPage`) and a History page, puts Users and Tokens in Settings
through `users_settings` (X-Libs 0.41.0) rather than a Users page or row, and asks every app to sync where it can. Apps
that do not yet:

- X-Backups: no Settings page in `src/`; Users is a page and a sidebar row (`src/web/main.tsx`, `src/web/views/users.tsx`). History is left out in its README (items come from config); no sync (server, agent and web only).
- X-Budget: Users sits at the foot of Your account (`src/web/App.tsx`); move it to `users_settings`.
- X-Fitness: Users is a page with a row in the sidebar foot (`src/web/App.tsx`, `src/web/Sidebar.tsx`); move it to `users_settings`.
- X-Music: no sync (Electron only, no server).
- X-Nix: Users is a page and a sidebar row (`src/web/main.tsx`); History is left out in its README (a log; items from config); no sync.
- X-Stream: Settings does not use `SettingsPage` (`src/pages/Settings/Settings.tsx`); its playlist versions have no History page of their own (`/history` is watch history); no X-Libs sync.
- X-Tasks: Users is a `#/users` page and a sections entry (`src/web/SignedIn.tsx`); move it to `users_settings`.
- CODEX: an options view on `SettingsGroup` rather than a `SettingsPage` (`src/web/views/options.tsx`); no History page and no README note leaving it out; no sync.

## Certificates (X-Libs 0.35.0)

- Check the certificate dialog on a real phone with a release build of X-Tasks, X-Budget or X-Fitness against a self-signed server; so far only the `XLibsCertificates` plugin has been run, on an Android 15 emulator whose WebView (124) could not load X-Tasks' page.
- A certificate trusted on the desktop holds for the window's own loads only from the next start, since `trust_in_session` sets the default session and Chromium keeps its first refusal there; sync and `create_main_fetch` already go through `trusting_fetch`, which holds at once.

## Old sign-in modules (next breaking release)

Every app signs in through `server/account_sign_in`, `server/account_store` and `web/react/sign_in` now, so the older ways can go in the next major version, with their tests and README rows:

- `server/password_sign_in` and `web/react/login`, the accounts-file sessions a restart forgets.
- `server/login_page` and the one-secret half of `server/sign_in` (the login page, the cookie derived from the token and the bearer check). Keep `register_sign_in_guard` and `path_of`, which `account_sign_in` and X-Backups' `auth.ts` use.
- Their README rows, the ones marked "For apps not yet on…". X-Monitor is the last app outside the shared accounts, and its TypeScript port should start on them rather than on these.

## Unrelated, for the owner

- The X-Backups health check reports critical because the two Odin Borgmatic repositories (on-disk and Ragnarok) have a failed or overdue check and a failing poll. The Ragnarok repository needs `borg check --repair` run with Heimdall's credentials.
