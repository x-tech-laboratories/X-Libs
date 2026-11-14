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

- From X-Music: facet pane, entity merge grid, outcome log, Cover, and the page-view tabs clipped under the header on first open.
- From CODEX: Electron autostart, tray and sidecar; reducer/effects store; NumberField; caption heading; the data-empty pattern; force_graph wrapper; StepLog; a scrollIntoView stub; adopt use_shortcuts; a yes/no-with-note dialog.
- From X-Stream: metadata cache with TTL, refresher, image-to-data-URI, parseViewCount and parseRelativeAge, loading overlay, sidebar entity list, threaded comments.
- From X-Nix: EventsList, a state-to-tone badge, the jobs table and job page.
- From X-Nix and X-Fitness: a Shell sidebar of section rows folding open onto their items (flakes, caches and hosts; a feature's pages), built on `Tree` with the folded rows kept in a pref and a folded section lit up in place of its hidden item (X-Nix `src/web/sidebar.tsx`, X-Fitness `src/web/Sidebar.tsx`), as `sections` with `children` on the `Shell`.
- From X-Nix: what a stalled long run waits for, read from /proc (its programs, the file locks they wait on and who holds them; `src/agent/waits.ts`), and the note it writes after a quiet spell (`src/agent/stalls.ts`), as an option of `agent/long_runs`; and notification channels read from a config list by `type` and sent to all, one failing leaving the rest (`src/server/notifications.ts`), as `server/notify/channels`.
- From X-Fitness: categories as rows with a parent (`src/shared/category_tree.ts`): paths read by `path_names`, an item's ids in a subtree, finding or making a category by a "/" path, merging a renamed category into a same-named sibling, and a migration turning "/" path categories into rows keyed by their old paths; with the folder-style browser of `src/web/categories.tsx` (`Crumbs` back up, a chip per subcategory), as a parent-linked side of `categories`.
- From X-Fitness and X-Stream: one item's versions in a dialog and the latest changes to every item, each restorable, on `history_methods` (X-Fitness `src/web/history/HistoryView.tsx`, X-Stream `src/components/PlaylistHistory/`).
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
- From X-Backups: fall back to a column id for an empty column label in web/tables.ts (DataTable throws on an empty label); Suggestions empty slot and source_delay_ms; FollowingOutput aria-label and tabIndex; guard extra paths such as /metrics; state badges, DurationBar and the live.ts client; an `extra` hook on register_error_replies.
- From X-Media-Tracker: a TMDB client for any app showing film or TV details, such as X-Stream (`src/shared/library/tmdb.ts`); filter counts where each choice is narrowed by every other filter but its own, to pair with X-Music's facet pane (`facet_counts` in `src/shared/library/model.ts`); reading a picked file's text and saving text as a download, which X-Fitness hand-rolls too; `pick_list_dialog` that can untick a list and show lists under group headings, for collections; running an async step over a list a few at a time (`refresh_library` in `src/shared/library/store.ts`), as a `map_limited(items, limit, step)` beside X-Monitor's `Semaphore`.
- From X-Media-Tracker's sync (2026-11-13): a relay mode for `sync_engine` and `sync_client`, so one server can be a device of another and pass on changes it took from its own devices; `collect_unpushed_changes` sends only the changes stamped with the device's own site, so today a server syncing to a server forwards only its own edits.
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

## Settings, History and Users in Settings (Application Standard, 2026-11-13)

The standard now gives every app a Settings page (`SettingsPage`) and a History page, puts Users and Tokens in Settings
through `users_settings` (X-Libs 0.41.0) rather than a Users page or row, and asks every app to sync where it can. Apps
that do not yet:

- X-Backups: no Settings page in `src/`; Users is a page and a sidebar row (`src/web/main.tsx`, `src/web/views/users.tsx`). History is left out in its README (items come from config); no sync (server, agent and web only).
- X-Budget: Users sits at the foot of Your account (`src/web/App.tsx`); move it to `users_settings`.
- X-Fitness: Users is a page with a row in the sidebar foot (`src/web/App.tsx`, `src/web/Sidebar.tsx`); move it to `users_settings`.
- X-Music: no History page (README: playlists are not edited yet); no sync (Electron only, no server).
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
