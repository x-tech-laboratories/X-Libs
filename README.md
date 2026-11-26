# X-Libs

<a href="https://liberapay.com/BeatLink/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a> <a href="https://ko-fi.com/I4V52ANK6N"><img alt="Support me on Ko-fi" src="https://ko-fi.com/img/githubbutton_sm.svg"></a>

Code the X-apps share, published as one npm package, `@x-tech-laboratories/x-libs`, with a subpath per module.

## Modules

| Import                                   | What it holds                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `durations`                              | `parse_duration` for settings such as `"2h30m"`, `format_duration` in months down to seconds and "less than a second" below one, `format_age`, and `format_clock` for a playing time such as `"3:07"`, with `{ hours: "always" }` writing `"0:03:07"` so a column of times lines up and `empty` for no time. |
| `log`                                    | Loggers by scope and level from a setting such as `"warn,play:debug"`; a malformed setting falls back instead of silencing logging, and a setting read through a function applies to loggers made before it arrived; a dotted scope such as `app.core.db` without its own level takes its nearest parent's. |
| `cron`                                   | `CronSchedule.parse`: five-field cron lines read in local time, with `@daily`-style aliases, month and weekday names, steps, ranges and lists, 7 as Sunday, a restricted day of month and weekday matching either as cron does, and a line that never matches a real date refused; `next_after` gives the first run strictly after a moment. |
| `recurrence`                             | iCalendar recurrence (RFC 5545) on rrule.js, ported from recurrence-input: `parse_rule` and `format_rule` for a rule without its `RRULE:` prefix, every `BY` part a list, unknown parts such as `X-` kept and an `RSCALE` calendar (RFC 7529) kept first; `parse_recurrence` and `format_recurrence` for `RRULE`, `EXDATE` and `RDATE` lines, folded lines read and `TZID` lines kept as written; `UNTIL` and dates written as plain dates, floating or UTC to match the event's start; `describe_rule` in plain English with times and `BYSETPOS`; `next_occurrence` with `COUNT` lowered in the value to keep; `next_from_now`; `parse_rule_part` naming the values a `BY` part allows. |
| `python_text`                            | Text as Python writes and reads it, for apps ported from Python: `python_repr`, `python_str`, `python_dumps` (json.dumps with its separators and escapes, keys sorted when asked), `python_format` with `apply_format_spec`, `format_fixed` and `format_grouped` ("{:.1f}" rounding an exact tie to even, "{:,.1f}"), `round_half_even`, `python_float_repr`, `split_lines`, `split_words`, `partition`, `parse_int`, `parse_float` and their `_or_null` forms, `fnmatch` and `python_regex` for `(?P<name>...)`. |
| `csv`                                    | CSV as RFC 4180 writes it: `parse_csv` into rows, a byte-order mark and blank rows dropped, `csv_records` by the header's names, `tsv_records` for unquoted tab-separated text such as LibraryThing's export, and `csv_field`, `write_csv` and `write_csv_records`, which quote only the cells that need it. Written in-house, as it is a page of code and the libraries add streaming and type guessing no app uses. |
| `zip`                                    | Several text files as one zip, such as an export of a few CSV tables: `zip_text_files`, `unzip_text_files` (folders left out, a file that is no zip refused in plain words) and `is_zip`, on fflate, chosen over JSZip because it works synchronously in a browser, on Node and in a phone's page with no dependencies, at a tenth the size. |
| `dates`                                  | Local dates as `"2026-06-10"` or `"2026-06-10T09:30"`: reading, writing, adding days and months, overdue, and Yesterday/Today/Tomorrow labels; days and months as text, such as `today`, `shift_day`, `month_of`, `shift_month`, `months_from` and `format_month` for `"June 2026"`, the month taken from the text so a time zone never moves the 1st. |
| `date_ranges`                            | Spans of time named from now as day.js rules: a date `is_before`, `is_after` or `is_between` (with a chosen inclusivity) points such as now or the start or end of last, this or next day, week, month or year; `resolve_rule` works the points out with the week starting on a chosen day, `matches_rule` places a plain date at the end of its day, and `DATE_POINTS` with `date_point_label` feed a picker. |
| `units`                                  | `convert`, `to_shown`, `to_stored` and `format_measure`; `GramUnit` with `from_grams`, `to_grams` and `format_grams` for small amounts kept in grams and shown in g, mg or µg, such as a food's nutrients; weights, lengths, distances and energy kept in kg, cm, km and kcal and shown in the unit each person picks, such as `"225 lb"`; `format_number`, whole numbers whole and the rest to a tenth, and `format_change`, a signed difference such as `"+1.5 kg"`. |
| `categories`                             | Categories nested by `/` paths such as `"Protein/Meat"`: normalizing, depth, leaf and parents, `is_in_category`, `all_categories` with the parents paths imply, `rename_in_categories` moving the subtree and merging onto a name in use, `drop_from_categories` taking the subtree, `filter_by_category` with descendants or the uncategorised, and `group_by_category` for grouped lists and selects. |
| `grouping`                               | `group_items`: items sorted into groups by a key each has, such as a status, a year or the collections they are in, an item with several keys in each of their groups, the app's `order` of keys first and the rest by name, numbers by value, `descending` when asked, each group keeping the items' order and those with no key last; for `GroupSections`, `GroupedMediaGrid` or a table under headings. |
| `money`                                  | `format_money` in a currency and locale to a set number of places, falling back to the number and code on a currency Intl refuses; `round_money` rounding halves away from zero, `money_step`, `sum_money`, `is_currency_code` and `currency_options` naming each currency for a select. |
| `i18n`                                   | Words in the reader's language: `create_translator` looks each key up in catalogs in turn, so a missing translation falls back to the next, with `{name}` placeholders filled; `merge_messages`; `best_locale`, the available locale that best fits the reader's preferred ones, an exact tag before the same language; `text_direction` for the `dir` attribute. |
| `sql`                                    | `SqlDatabase`, the part of a synchronous SQLite connection the apps use, met by node:sqlite and by `web/sqlite_wasm`; `in_transaction`, and `migrate`, each step once in its own transaction, through `user_version` or, with an `owner` such as a feature or plugin, its own row in `schema_versions`. |
| `api_spec`                               | An app's calls described once for other programs: `ApiSpec` gives each method its words and a JSON Schema per argument, so a method without one fails to compile; `input_schema` takes the arguments as one object, `positional_args` puts named arguments back in the method's order from a spec or any `NamedParams`, `openapi_document` writes an OpenAPI 3.1 document with one POST per call, and `route_openapi_document` one for REST routes such as `server/mcp`'s `route_tools` serves, each under its own path and verb with its path, query and body arguments; `check_known_ids` refuses a call naming an id that does not exist, such as "no such track a1", before it acts, `unknown_ids` lists them, and `keep_known_ids` cuts a remembered list, such as picked columns, down to the ids that still exist. A spec marked `page_only: true` is a call only the user may make at the app's own page (a signed-in browser, or a desktop window through its daemon's socket), such as approving what an assistant proposed: `page_only_calls(api, { rule?, refusal? })` gives the `PageOnlyCalls` the other modules take (`is_page_only(method)` for the marks, `is_page_only_call(method, args)` adding the app's `rule(method, args)` such as a write to some settings, `is_page_only_request(method, body)` for arguments as a list or by name, unchecked so a call with wrong names is left to refuse them itself, and the `refusal` text, `default_page_only_refusal` unless set), and both OpenAPI documents mark such a call with `x-page-only: true` and a 403. |
| `filter`, `filter_sql`                   | Filters as one JSON tree of conditions under and, or and not, over fields the app lists in a catalogue (`define_catalogue`): a column, an SQL expression over the row, a related table matched when any of its rows matches, a set of values in a link table, kept as they are or once in a table of their own, or a `custom` field; tables and columns named as text or as the Drizzle schema's own objects. `compile_filter` makes one parameterised query for any `SqlDatabase` (`query_rows`), missing values last whichever way it sorts and ties broken by id so pages never shift, and a `random` sort key's whole-number `seed` giving the same shuffle each time, in SQL and in memory (`shuffle_position`); `compile_group_by` counts and sums each value of a field for panes; `evaluate` and `select_ids` check records in memory and `sort_records` sorts them, with exactly the same answers and order, which a property test holds them to; text, number, set and date operators, `top` and `bottom`, `in_last` in milliseconds, seconds or ISO dates, `in_filter` for a saved filter with `find_cycle`, the app's own `operators` such as full-text search, `regexp_matches` for the REGEXP a `regex` calls, and `FilterStack`, the removable chips a view shows. |
| `filter_query`                           | `parse_filter_query`: search text such as `artist:beatles rating:>3 year:1965..1970 -live played:<30d` read into one filter over the fields the app lists (text, set, number or date, each with the names users type), so one search box serves every field. A text field takes `:` for contains, `=` for exact, `a,b` for either and `/pattern/` (matched with case, as `regex` is); a set field finds its listed values whatever their case; numbers take `>`, `>=`, `<`, `<=` and `a..b` through the field's own `parse_number`, such as stars into a rating; dates take `<30d` and `>6m` (h, d, w, m, y) and whole years, months or days such as `2024-03`, in the field's clock. A leading `-` leaves a term out. Each term comes back with where it is, its filter and a label for a chip, and `without_term` takes one out of the text; anything not readable as a field's condition is searched as words through the app's own text filter, never an error. |
| `format_strings`                         | `format_string` and `format_record`: text the user sets made from an item's fields, `{title}`, `{album_artist\|artist}` for the first one not empty, `[{disc}.]` left out when a field in it is empty, `{track:%02d}`, `{length:m:ss}`, `{genre:join(", ")}`, `count`, `first`, `basename`, `dirname`, `ext`, `upper`, `lower` and `title`, and the app's own `formats`, such as stars for a rating; values from any source, `compile_format` to read a template once, `template_fields` for what to fetch. |
| `drizzle`, `drizzle_migrations`          | Typed SQLite on Drizzle ORM 1.0.0-rc.5, chosen over Kysely and hand-written SQL because it types rows from one schema in TypeScript, writes the migration SQL from it with drizzle-kit and runs synchronously: `open_drizzle` over any `SqlDatabase`, and `drizzle_of`, which the stores call, making it once per connection, so the same queries run on node:sqlite and in a phone's page, `synced_tables` reading the sync list from the schema's primary keys, `migrate_drizzle` per owner, the schema builders and query operators so an app never imports Drizzle, with `AnySQLiteColumn` for a table whose rows point at its own, and `x-libs-bundle-migrations <folder>`, which turns drizzle-kit's migration folders into an `index.ts` a server running .ts files can import. |
| `sync_engine`, `sync_client`, `sync_protocol`, `server/sync_routes` | SQLite kept alike on every device: `create_sync_engine` stamps each value of the tables it is given through triggers, so the app's own writes need no change, and the newest write of each value wins, each key of a table's `map_columns` (JSON objects such as ids from many sources) counting as a value of its own so two devices adding different keys keep both; `create_sync_client` sends a device's changes within seconds, takes everyone else's in the same round trip, follows the server's event stream, works on offline, and asks which copy to keep once the server's data was replaced; it signs the device in with a name and password for a token of its own (`asks_for_code` tells when the second factor is wanted) and gives the token back when it stops syncing; `register_sync_routes` is the server's exchange, snapshot and replace, which backs up first. Given `device_only(change)`, such as a setting only the user may change, an exchange holding such a change is refused whole (403, `device_only_refusal`) unless it comes from the user's own device or page, and so is every replace; that is a session, the trusted proxy or a token the device sign-in made (`server/viewers`' `is_user_or_device`), or whatever the app's own `is_device(request)` says. Without `device_only` every signed-in writer syncs as before. |
| `sync_files`, `node_file_store`, `electron/file_protocol` | Files that sync beside the rows that name them, such as covers or photos, so a large picture never travels with every change: each is named by the sha256 of its bytes (`hash_bytes`, `put_file`, `is_file_name`) and kept in a `SyncFileStore`, a folder on Node (`folder_file_store`, written through a rename) or IndexedDB on a phone (`indexed_db_files`); given `files: { store, referenced }`, the sync client sends the server the named files it lacks and fetches those the device lacks after each exchange, a few at a time, trying a file the server does not have yet again next round, and `register_sync_routes` given `files` keeps them, refusing bytes that do not match their name; `register_file_scheme` and `serve_files` show them in a desktop page as `<scheme>://<name>`. |
| `app_icons`                              | `x-libs-icons [app folder]`: every icon an app ships generated from its `resources/icon.svg`, as the Design Guidelines ask: `resources/icon.png` for the desktop, the Android launcher icons at each density with an adaptive icon on white when there is an `android/` project, and `icon.svg`, `icon-192.png` and `icon-512.png` in `src/web/public` when there is one. Drawn with `@resvg/resvg-js`, an optional peer the app installs as a dev dependency. |
| `change_checks`, `change_checks_git`, `change_checks_cli` | Checks on a change that any repository's CI runs, as `x-libs-check` (see [Change checks](#change-checks)): `commits` (Conventional Commits, the `Assisted-by` trailer in the organisation's repositories and nowhere else, no AI mention outside it), `secrets` (keys and tokens in added lines, commit messages and added `.env` files, naming only the kind and place, never the value), `leftovers` (console logging, `debugger`, code commented out, a TODO without an issue), `comments` (a comment longer than one line, but for a file's overview), `coverage` (a floor lowered or code newly left out), `x-libs` (an import of a library X-Libs wraps) and `dependencies` (each new one named with its licence, failing a licence not allowed, read as SPDX by `spdx-satisfies`); each a pure function on a described `Change` giving `{ gate, outcome, findings }` with file:line, reading only the code around strings and regular expressions; `create_check_registry` for an app's own checks, `x_tech_options` the defaults, and `read_change` reading a change from git, its `base` resolved to a commit; `run_check_command` runs the command for an app with its own checks, defaults and name. |
| `certificates`, `certificate_protocol`, `electron/certificates` | Servers whose https certificate the device refuses, such as a home server's self-signed one: `check_certificate` reads the certificate and what is wrong with it (self-signed, unknown authority, wrong name, expired, not yet valid), `create_certificate_trust` keeps the ones the user trusts in a JSON file, each for its own host and exact fingerprint, re-checked before it is saved, and its `methods` are the page's calls; `trust_in_session` makes Chromium accept them in a session, the window's from the next start, and `trusting_fetch` sends the main process's requests, such as the sync client's, through a Chromium session made fresh each time the list changes, so a new choice holds at once; `use_in_node` also hands them to Node's own https, which then accepts a self-signed server whose name matches. |
| `sync_file_storage`                      | `file_sync_storage({ file, back_up_before_download })`: the sync client's server and token in a JSON file on Node, written only its owner can read (mode 0600, tightened on an existing file too), a missing file read as none, removing it twice harmless. |
| `web/sync_storage`                       | `local_sync_storage({ key, back_up_before_download })`: the same in a phone page's own local storage. `SyncDeviceMethods` and `sync_device_methods(client)` in `sync_protocol` and `sync_client` are the calls every app's bridge answers for its page. |
| `backups`                                | Named backups of an app's data in any store, newest first, with daily automatic ones kept to a set number; `keep_backing_up` takes them on a schedule the app keeps, and `BackupMethods` are the calls a page makes to whatever holds them. |
| `phone_certificates`                     | `phone_certificates()`: the page's certificate calls on a phone, answered by X-Libs' Android plugin `XLibsCertificates`, which `cap sync` adds by itself: it reads a server's certificate and what is wrong with it, keeps the ones the user trusts for their own host and fingerprint, and installs a WebView client that lets the page's requests through to them, so `SyncSettings`, `SyncCertificatePrompt` and `TrustedCertificates` work on a phone as on the desktop. Forgetting one holds from the app's next start, since the WebView keeps a connection it already opened. An app that sets its own WebView client replaces that one. |
| `phone_backups`                          | `phone_backups`: a phone app's `backups` in a folder the user picks once in its storage, where file managers and sync apps reach them, through X-Libs' Android plugin `XLibsBackupFolder`, which `cap sync` adds by itself; `restore` backs up first, swaps the phone database's bytes and saves, `folder_name` and `choose_folder` for the settings row, and daily backups wait quietly until a folder is picked. |
| `phone_notices`                          | `keep_phone_notices`: notices handed to a phone ahead of time through Capacitor's local notifications, the app passing its own `LocalNotifications`, since a phone has no daemon; `refresh` takes back every pending notice and sets the soonest 64 of the next 14 days again, `ask_permission` asks once, `show` puts a notice up at once with no alarm (`isExactNotification: false`), so a notice for now never needs Android's exact-alarm leave or opens its settings screen, `exact: false` lets the notices set ahead ring inexactly too, and a tap hands the notice's `extra` back, such as a link to open. `notice_id` names a key as Android's number. |
| `phone_service`                          | `phone_service`: work a phone app keeps doing while it is closed, such as staying reachable, in an Android foreground service run by X-Libs' plugin `XLibsForegroundService`, which `cap sync` adds by itself: the service loads the app's own worker page (such as `worker.html` from its page files) in a WebView it owns, so the work outlives the app's window, a killed process (Android starts it again) and, with `start_at_boot`, a reboot; `start`, `stop`, `is_running`, `post` and `on_message` for the page, and `worker_host` for the worker's side, the messages crossing as JSON. The app declares the service and the boot receiver in its own manifest, with the `connectedDevice` foreground service permissions, as the module's opening comment shows, so no other app gets them. |
| `phone_sockets`                          | `phone_sockets()`: UDP and TCP sockets for a `phone_service` worker, answered by X-Libs' Android side: `udp_open` (with `broadcast`, holding Android's multicast lock), `tcp_listen`, `tcp_connect` and `list_interfaces`; a TCP socket reads nothing until `read_line` takes one line or `start_reading` everything after, so `start_tls` can follow plain text in either TLS role, as KDE Connect's identity line does, with the app's PEM certificate and key, letting any peer through and handing back its certificate for the worker to pin; `pause` and `resume` for a slow reader, and `write` settling once sent. Events that arrive before a listener are kept for it. Needs `CHANGE_WIFI_MULTICAST_STATE` and `WAKE_LOCK` in the app's manifest; each event keeps the phone awake a few seconds so the worker can answer. |
| `history`                                | Every change to an app's items kept as versions in SQLite: `create_history` sets triggers on the tables that change an item, `record` saves one version of each item touched, and `restore` brings a version back, a deleted item with what was deleted under it; the versions table syncs, `read_changed_since` gives the newest version of each item changed after a moment, oldest first, and `history_methods` are the page's calls. Its tables are made only where missing, so an app with its own older versions table keeps it, naming its item column with `item_column`. A table that reaches its item only through another, such as a workout's sets through its exercises, names it with `item_lookup`, a query from the row. |
| `items`                                  | The four read-only calls every app answers about its items for other apps ([Items for other apps](#items-for-other-apps)): `item_calls` turns the app's own kinds, search, get and changes into `list_item_kinds`, `search_items`, `get_items` and `list_item_changes` with their `api_spec` entries, every item in one shape (`Item`, `DeletedItem`, `ItemChange`) with its snippet clipped to 200 characters, limits defaulted and capped, and changes oldest first; `item_link` and `parse_item_link` for `x-<app>://<kind>/<id>` links with the id percent-encoded; `history_item_changes` answers the changes from `create_history` versions; a source with `text` adds the optional `get_item_texts`, each item's full text (`ItemText`) as plain text or Markdown cut to 256 KB by `clip_item_text`, and `has_text` on each kind. |
| `item_client`                            | Reading another app through its item calls: `item_client(app)` makes `list_item_kinds`, `search_items`, `get_items`, `list_item_changes` and `get_item_texts` at `POST /api/call/<method>`, falling back to the older `/api/<method>` and remembering which answered, ids sent a page at a time, `get_item_texts` null for an app that does not answer it (`ItemCallMissing`), and failures in plain words that never hold the token. |
| `plugins`                                | `create_plugin_host`: plugins bundled with the app or loaded at run time, each a manifest and a `start(context)`, started in the order their `requires` need and refused when meant for another app or app version; through the context a plugin adds hooks the app calls (on hookable, chosen for its typed, ordered and parallel calls with nothing of its own to style), providers the app picks one of by id, commands with keys, slot contents and settings fields, all taken back when it stops, is turned off or fails to start; one plugin's failing hook is reported and the rest still run; on/off and settings kept through `json_plugin_storage`, stored values that no longer fit falling back to their defaults; a text field marked `secret`, such as an API key, drawn hidden, replaced by `hidden_secret` in what `hide_secrets` gives other programs and given back its stored value by `keep_secrets` when those records are written; versions checked with semver. |
| `plugin_folder`                          | `load_plugin_folder`: the plugins in a folder's subfolders, each `package.json` naming its built entry per side under `"x-plugin"`, refused when it leads outside its subfolder, with a problem per broken subfolder instead of a throw; `plugin_index` is the page's list of entries, and `read_plugin_file` answers a page that reaches the folder over IPC, as a desktop app's does, with that list or a plugin's own file and nothing outside it. |
| `server/plugin_files`                    | `register_plugin_files`: `/plugins/index.json` lists the folder's web entries, read afresh on each request, and each plugin's own files are served from its subfolder and nowhere else. |
| `web/plugin_imports`                     | `load_plugin_modules`: imports the entries `register_plugin_files` lists, each one bundled file whose imports of modules the page hands over with `share_modules`, such as React, are pointed at the page's own copies, found with es-module-lexer; `bridge_fetch_text` reads them through a call such as a desktop's IPC to `read_plugin_file` instead of fetch. |
| `web/react/plugins`                      | `PluginSlot` draws what running plugins put in a slot, each part behind react-error-boundary so one that throws is left out alone; `use_plugin_shortcuts` and `plugin_menu_items` for their commands; `PluginSettings`, the settings page's "Plugins" group with a row per plugin showing its version, state, why it waits or failed and its on switch, then its fields as controls, a secret one as a password field, its heading left out with `heading={null}` inside a section that names it; `plugin_id` on `PluginSettings` and `PluginSlot` draws one plugin alone; `use_plugins`. |
| `electron/bridge`                        | `define_bridge`: one method table for the preload, the main process, and a web page's calls to its server; `handle` takes a `trusted` guard on the sender frame and answers in `envelopes`, which the client unwraps into Errors with the message alone, and a plain client strips Electron's remote-method prefix; `to_envelope`; `with_cloneable_arguments` flattens what structured clone refuses, such as a Proxy. |
| `electron/events`                        | `define_events`: messages the main process pushes to its pages, such as progress, on one channel and subscribed to by name. |
| `electron/log`, `log_protocol`, `web/page_log` | One log for an Electron app: `create_main_log({ setting, file })` writes `log` records to the terminal, warnings and worse to stderr, and adds them to a file when given one, a file that cannot be written leaving the app running; its `methods` (`PageLogMethods`, named by `page_log_method_names`) are the bridge's calls, `write_log` taking the page's records under `page.<scope>`, checked by `read_page_record`, and `get_log_levels` handing the page the setting; `create_page_log(client)` gives the page `logger(scope)`, whose records follow those levels once `start()` has fetched them, Errors sent with their stack, and reports uncaught errors and rejections until `stop()`. |
| `electron/app`                           | `hold_single_instance`, `bring_to_front`, and `first_argument` for a link handed over on the command line. |
| `electron/window`                        | `create_window`: links and other sites open in the browser, and links in the other apps' schemes the app names (`external_schemes`, such as `stremio:`) open in those apps, the background is Halon's root surface and follows the system theme (`halon_background` reads it from the app's installed `@x-tech-laboratories/halon` sheet, falling back to `HALON_BACKGROUND`, and `background` overrides it), and the size and place are remembered, through the app's write guard if it has one; timers can keep running while hidden; Electron's default File/Edit/View menu bar is dropped unless `menu_bar` keeps it. |
| `electron/fetch`                         | `create_main_fetch` and `create_page_fetch`: the page's requests sent from the main process past cross-origin rules, to an allow-list of hosts, with headers such as `Origin` pinned; `create_main_stream_fetch` and `create_page_stream_fetch` carry the body chunk by chunk over an events channel into a `ReadableStream` body, for a player that reads as it lands, cancelled by the request's signal. |
| `electron/mcp`, `local_mcp_protocol`, `web/react/local_mcp_settings` | A desktop app's own MCP endpoint, for AI clients on the same computer: `create_local_mcp` serves an `api_spec`'s calls as tools through `server/mcp` on 127.0.0.1 only, leaving out page-only calls and refusing the uses its `page_only` rule names, since the window reaches those over the daemon's socket, refusing any request whose Host or Origin is not a local name, turned on and given a port by `LocalMcpMethods` and kept in a settings file; with `require_token` on it also refuses any request without its token as `Authorization: Bearer`, the token made by the daemon and kept in `token_file` (`mcp-token` beside the settings unless set, mode 0600), kept across restarts and forgotten when the setting is turned off, and the status then carries `token` and `token_file`; `local_mcp_client_config` gives the `mcpServers` entry with its `headers`, and `local_mcp_add_command` the `claude mcp add` line reading the token from its file; `LocalMcpSettings` is the Settings rows to turn it on, pick the port, require a token, copy the `claude mcp add` command and show or copy the client config. |
| `agent/commands`                         | `run_command` and `stream_command`: one shell command, in its own process group. |
| `agent/programs`                         | `run_program`: one program with its arguments and no shell, each stream shown to a sink, kept, both or dropped, stopped by an abort signal and, in a process group of its own, with all it started; 127 when it is not installed; `BoundedBuffer`, `signal_group` and `on_path`; `whole_lines(sink)` passes on only whole lines, decoding characters split across chunks, with `flush()` for the rest, so programs printing side by side into one output never split each other's lines. |
| `mpv`                                    | Media played through mpv, run as a program of its own and driven over its JSON IPC socket: `MpvEngine` plays one file at a time behind `PlaybackEngine` (load with a start, an end, a gain in decibels and mpv's own per-file options, the next file appended for a gapless join, play, pause, stop, seek, volume, and `state`, `position` and `ended` events), sound only unless `video`; `MpvProcess` is mpv itself, found by `find_mpv` (each override in turn, then the PATH, through `on_path`) and started on the first command, its socket moved to /tmp when the temporary folder's path is too long for one, a start that fails or times out refused with why and mpv's last log line, started again by the next command after a failure or an exit, with `observe` for properties kept across restarts, `on_event`, `on_stop` and `close`, which waits until mpv has gone; `NullEngine` for testing an app's player without mpv. |
| `agent/wake`                             | `magic_packet` and `send_magic_packet`: Wake-on-LAN, a few copies of the packet broadcast to a port, sent by a server or by an agent on the sleeping machine's network; `parse_mac` takes colons, dashes, dots or none, a SecureOn `password` follows the packet (`parse_password`), `send_wake_packet` sends a ready packet, and `remote_send_command` is the shell line that sends it from another host with python3 or socat. |
| `agent/desktop_notify`                   | `Notifier`: desktop notifications through notify-send in the agent's own session, with a Dismiss button, a link opened by xdg-open on a click, a timeout the agent enforces even for critical ones, and keys, so a newer notification for a key replaces the old and dismissing the key closes it; the app names itself and maps its own icon names to files. |
| `agent/scheduled_notices`                | `keep_giving_scheduled_notices`: notices that fall due at set moments, such as reminders, shown through a `Notifier` by a daemon with or without a window; each check shows what fell due since the last, and the moment reached is kept so one missed while stopped still shows, up to half a day late. |
| `agent/inhibit`                          | `IdleInhibitor`: keeps the host from idling into suspend while anything holds it, through one systemd-inhibit lock shared by every holder and let go a moment after the last; the lock dies with the agent, and a suspend the user asks for still goes ahead. |
| `local_daemon`, `autostart`               | A desktop app's daemon and window, as the Application Standard sets out: `daemon_socket_path` is `$XDG_RUNTIME_DIR/<app>/daemon.sock`, or a socket of its own for any other data file, such as a test database; `listen_on_socket` serves a server there for its user alone, removes a socket a dead daemon left and refuses with `DaemonRunningError` while another answers; `start_daemon` starts the daemon apart from the window unless one answers, on Electron's own binary as Node, without the descriptors Electron leaves open (`covered_descriptors`), its output in `daemon_log_path`, and waits until it answers or says why it died, or with `replace_other_build` first stops a daemon of another build, which `listen_on_socket` records beside the socket (`read_daemon_build`, `daemon_build_id`, a hash of the entry file), so a window opened after an upgrade does not use the old daemon; `call_daemon` posts a call with its arguments as a JSON array; `follow_daemon_events` follows its server-sent events, reconnecting when the daemon comes back. `autostart`: an XDG autostart entry (`set_autostart`, `is_autostart_on`, counting one the desktop hid as off), with `launch_command` starting the app again from Flatpak, an AppImage, the packaged binary or Electron and the app's folder. |
| `connections`, `connection_protocol`, `connection_file_storage`, `web/connection_storage`, `daemon_link` | The daemons a desktop or phone app connects to, like Deluge's connection manager: `create_connections` keeps "This computer" where the app offers a local daemon (`offers_local`, false for a portal app such as X-Nix and on a phone) and daemons on other hosts, each signed in once as the device (`device_name`) for a token of its own that the page never sees, a second sign-in by the same user only renewing it and removing one giving it back; the chosen daemon falls back to this computer, then the first remote one, and `subscribe` hears when it changes; its `methods` (`ConnectionMethods`, named by `connection_method_names`) are the bridge's calls, and `connection_address` makes a typed address whole. The list is kept by `connection_file_storage` in a file only its owner can read, or `local_connection_storage` in a phone page's local storage. `create_daemon_link` sends the main process's calls to the chosen daemon, over the local socket through `call_daemon` or to a remote one over http(s) with the token, and `follow_events` follows its change events, moving to the new daemon by itself; `follow_remote_events` is `follow_daemon_events` over http(s). |
| `electron/tray`                          | `create_app_tray`: a desktop app's tray icon, shown or taken away by a setting (`set_shown`), its tooltip and menu read from the app as plain rows (`TrayView`) on a timer and on `refresh`, a failed read keeping the last menu; `app_rows` gives the Show, Quit and Quit completely rows every app ends with, and `tray_groups` rules groups of rows off from each other. |
| `agent/local_socket`                     | `LineServer` and `follow_lines`: JSON messages, one per line, handed from one local process to every follower of a unix socket, the follower reconnecting whenever the socket is not there, such as a desktop agent following a system agent's notifications. |
| `agent/long_runs`                        | `LongRuns`: commands that outlive the agent, their output and exit code kept on disk; optionally each in a transient systemd unit and slice, so a stop ends everything it started. |
| `agent/stalls`                           | What a stalled long run waits for, read from /proc: `watch_for_stalls`, run beside the task in a long run's runner, writes a note into the run's output once it has printed nothing for five minutes and again each half hour: the programs it still runs, the file locks they wait for and who holds them, a known lock named by what it is with a line of advice; `describe_stall`, `lock_holders`, `read_processes`, `read_locks` and `show_holders` for asking the same questions directly. |
| `agent/keys`                             | Reads and makes OpenSSH ed25519 agent and server keys; signs and checks the login challenge, and the server's signed challenge, bound hello and messages (`server_challenge_text`, `agent_hello_text`, `server_message_text`, netstrings by `signed_bytes`); `public_key_line`, `public_line_of_private_text` and `fingerprint_of` give a key's public line and fingerprint as ssh-keygen does; `parse_server_keys` reads the accepted server keys. |
| `agent/protocol`                         | The messages between the server and an agent, and the `signed` frame (`encode_signed_message`, `parse_signed_message`) that wraps each message a server with a key sends an agent that checks it. |
| `agent/session`, `agent/client`          | The agent's side: `start_agent` dials the server and answers it; with `server_keys` it answers only a server that signs its challenge and every message with one of them, hanging up with `server_refused_close_code` on anything else, and without them it warns once that TLS alone proves the server. See [Proving the server to agents](#proving-the-server-to-agents). |
| `agent/tasks`                            | `TaskRunner`, and `shell_runner` for apps whose tasks are command lines.      |
| `server/agents/hub`                      | `AgentHub`: the agents that have dialled in, and the server's built-in one; every refused upgrade answered alike (`admission_refused`), at most `most_pending_logins` sockets (8 per address with `most_pending_logins_per_address`) waiting to log in, a socket closed on a first message that is not a hello or one over `pre_login_message_limit_in_bytes`, and a hello's runs and texts clipped; with a `server_key` it signs its challenge to every agent and every message to an agent that asks (`signed_messages` in its status), and gives `server_public_line()` for the agents' config. |
| `server/agents/connection`, `agent`, `local`, `route` | One connected agent, each message to it signed when it asked, its replies checked and clipped (`parse_long_run_poll`, `parse_long_runs`, `parse_long_run`, `parse_run_result` in `agent/protocol`) and a malformed one rejected as an `AgentError` to try again, the `Agent` interface, `LocalAgent`, and the Fastify route, which holds each socket's frames to the pre-login size until its hello is accepted. |
| `server/passwords`                       | scrypt hashes and the `name:hash` accounts file. `hash_password` and `verify_password` block the thread, for commands and tests; a request handler uses `hash_password_async` and `verify_password_async` on Node's thread pool, through `PasswordHashSlots`, which runs `default_hashes_at_once` (2) at once with `default_hashes_waiting` (8) queued and refuses the rest with `PasswordHashesBusy` (429, Retry-After 1); `shared_password_hashes` is the process's one set, and a test hands in a slow `PasswordHasher`. A hash that is not whole hex is refused. |
| `server/attempt_limit`                   | `AttemptLimit`: tries per key, such as an address or a user, in a fixed window, a try that succeeded given back with `give_back` so only failures and tries still running count, at most 10000 keys remembered; `too_many_tries_text` is what every sign-in limit answers. |
| `server/hash_password`                   | The `hash-password` command.                                                  |
| `server/backup_files`                    | `file_backup_store`: the `backups` store as files in a folder on disk.        |
| `server/sqlite_backups`                  | `sqlite_backups`: the `backups` of an SQLite database as `VACUUM INTO` copies in a folder, and `restore`, which backs up the current data first and swaps the file under a closed connection; a server whose connection others hold leaves out `close` and `open`, so the restore is staged beside the database and `take_staged_restore` puts it in place on the next start, before the database opens. |
| `server/backup_routes`, `web/backups`    | A server's backups for the page's `BackupSettings`: `register_backup_routes` serves the list, backing up now, the daily schedule, restoring and deleting, with the schedule in a JSON file through `json_backup_schedule`; `backup_client` is the page's side. |
| `server/sign_in`, `server/login_page`    | `register_token_sign_in`: a server with one secret signs browsers in on its own login page, keeps them in by an HMAC-derived cookie, takes the secret as a bearer header, waits after a wrong try, answers 429 with Retry-After once an address has `address_tries_allowed` (20) wrong tries in `address_try_window_seconds` (300), the right ones not counted, and turns the rest away (401 in text or JSON under the API prefix, 303 to the login page elsewhere, with open paths); `register_sign_in_guard` is the turning-away alone, for an app with its own sessions. Both judge the path as the router reads it, count any route matched under the API prefix as the API, and answer 400 to a path that reads two ways (see `server/request_path`). |
| `server/request_path`                    | `path_of`: a request's path as Fastify's router reads it (escapes decoded as it decodes them, its semicolon, trailing-slash, duplicate-slash and case options followed); `route_of`: the matched route's pattern; `is_plain_path`: false for a path that reads two ways (an escaped letter, digit or `-._~`, a `#`, a target not starting with `/`, an empty, `.` or `..` segment, or a path not beginning as its route does), which the sign-in guards refuse. Escapes such as `%20` and `%2F` stay allowed. |
| `server/account_store`                   | `AccountStore`: users with the app's ordered roles and its own access rules, checked by `check_access`, the accounts file's users declared at the highest role, second factor with recovery codes, sessions and tokens, all in the app's SQLite database under `account_*` tables. Request handlers call `authenticate_async`, `change_password_async`, `create_user_async` and `update_user_async`, which hash in `password_hashes` (`shared_password_hashes` unless set); the synchronous ones stay for scripts and tests. A user gets `secret_tries_allowed` (5) wrong second-factor or recovery codes, signing in or turning the second factor off, in `secret_try_window_seconds` (300), and as many wrong current passwords apart from those, before waiting: `authenticate` then answers `retry_after_seconds` and the others throw a 429 `AccountError` carrying it. `token_scopes` names the narrower tokens the app offers beside full and read-only ones, such as `{ add_items: { label: "Add items", hint, calls: ["add_item"] } }`: a token made with `create_token(owner, { name, read_only, scope })` reads as a read-only one does and may also make its scope's calls. A token lasts `days` when given; `longest_token_days` caps that and is how long a token lasts without it, and an ended token no longer signs in. Each token has a `kind`: `device` when the device sign-in made it (`create_token(..., { kind: "device" })`, always a full token), `program` for one made on the account page; a full, unscoped token made before kinds were kept counts as a device, so no device is cut off, and the token lists show a device chip so a program's token from then can be revoked. |
| `server/account_sign_in`                 | `register_accounts`: the standard sign-in. A name and password (then the code when the user has a second factor), single sign-on or a trusted proxy opens a session kept in the database; "Keep me signed in" unticked ends it with the browser, ticked keeps it until revoked, both bounded by `session_seconds` and `remembered_seconds`. One name from one address gets `tries_allowed` (5) tries in `try_window` ("5 minutes"), and one address gets `address_tries_allowed` (20) failing or running sign-ins in `address_try_window_seconds` (300) whatever names it gives, a right password not counted; either answers 429 `{ error }` with Retry-After, the same for a name that exists and one that does not, and a code refused by the store's own limit adds `code_needed` (see [Accounts](#accounts)). `second_factor_from` names the lowest role that must use a second factor: until such a user sets one up, their session only reads, signs out and sets up the second factor or password, and cannot make tokens or sign in devices; `/api/me` says so with `second_factor_needed`. A device signs in with `device` and gets a token of kind `device` instead; a request's `viewer.token_kind` says which kind of token it came with (a declared token's is `program`), and `is_user_or_device(viewer)` whether it is the user at the page or on one of their devices rather than a program. It also serves the account routes (password, second factor, sessions, tokens), the admin's users and tokens, and checks each app route, and any `guarded_paths` outside the API such as `/metrics`, against `needed(method, path, route)`, which gets the path as the router reads it and the matched route's pattern (such as `/api/builds/:id`, or null); `open_prefixes` leaves routes that check their own credentials, such as a push URL, open; a read-only token only reads, except on `read_only_paths` such as `/api/mcp` that keep it to reading themselves. Given `call_of` (such as `calls_under("/api/call")` for a call table) and `is_read_only`, a read-only token may also POST the calls that only read, and a scoped token its scope's calls, on the API as over MCP; `GET <api>/account/token_scopes` lists the scopes for the token form. Given `call_of` and `page_only` (from `api_spec`'s `page_only_calls`), every token, a device's included, is refused the calls only the user at the page may make, by their marks before the body is read and by the app's rule once it is; a session or the trusted proxy makes them. |
| `server/totp`, `server/oidc`             | Authenticator-app codes (RFC 6238) and their `otpauth://` links; `OidcClient`, single sign-on by the code flow with PKCE and a checked ID token, set up from `<PREFIX>_OIDC_*` by `oidc_from_environment`. |
| `server/password_sign_in`                | For apps not yet on `server/account_sign_in`. `register_password_sign_in`: names and passwords from the accounts file open a session the server keeps (on @fastify/session) through `/api/login`, with `/api/logout` and `/api/me`; a wrong name takes as long as a wrong password, an address gets a few tries whatever names it gives before it waits (on @fastify/rate-limit), passwords are checked in `password_hashes` (`shared_password_hashes` unless set), and other API paths but the open ones answer 401 as JSON. |
| `server/forge_webhook`                   | A forge's pushes: `is_signed` for GitHub's HMAC, Gitea's and Forgejo's signatures, a bearer token or GitLab's token; `event_of`, `parse_payload` and `read_push`, which names the branch and the repository URLs through the app's own normaliser; `AddressLockout` for an address that keeps failing to sign; `SeenDeliveries`, whose `is_replay` notices a signed body sent again within a day; `Debouncer` so a burst of pushes starts one run; `register_webhook_route`, which keeps the raw body the signature covers. |
| `server/poller`, `server/runs`           | `CyclePoller`: each watched item's cycle on its own timer, every `interval` or every `job_poll` while busy, with `refresh` and `soon`; `follow_run`: a long run's new output copied to a sink and the run finished once it has ended, with `describe` and `translate` hooks, an unreachable agent, a malformed or stuck poll reply, or a failing sink leaving it as `unreachable` to be followed again and only an agent that no longer knows the run ending it early, each follow taking at most `most_polls_per_follow` polls and about `most_output_per_follow_in_bytes`, and a `translate` that throws keeping the raw output. |
| `server/events`                          | `EventStream`: server-sent events with a client id per page, a heartbeat, `announce_change(except_client_id)` so the page that made a change is not told, nameless or named events to all or chosen clients, headers set before the stream opens (such as `register_open_cors`'s) sent with it, and every stream ended with the app; `leading_cooldown` sends the first change at once and a burst's rest once per cooldown. |
| `server/call_table`                      | `register_call_table`: a table of calls served as POST `<path>/<method>` with the arguments as a JSON list, as a desktop app's daemon and a web server both answer them, and by name as a JSON object for the calls whose argument names `params` gives, such as the app's `api_spec` (`api_spec`'s `NamedParams` is all it needs); a name the table lacks (its prototype's included) is refused, every answer goes as JSON so a string stays a string, a read is sent uncached, and `on_change` runs after any call `is_read_only` does not pass, with the caller's client id. |
| `server/leases`                          | `Leases`: what a page holds open while it shows something costly, such as fast polling of a running job while its log is open, each lease ending when closed or once it goes unrenewed for a while. |
| `server/security_headers`                | `register_security_headers`: every answer carries a content security policy that runs only the app's own scripts (`default_content_security_policy`, with directives the app replaces through `content_security_policy`, or none with null), `X-Frame-Options` and `frame-ancestors` refusing framing unless `allow_same_origin_frames`, `nosniff`, a same-origin referrer policy and opener policy; headers a route sets itself are kept. |
| `server/web_folder`                      | `register_web_folder`: the built page from a folder, tuned for the Nix store (no etag or date, hashed `/assets/` kept a year, the page fetched fresh), a warning, error or nothing when the folder is missing, and the page for unknown paths when it routes itself. |
| `server/replies`                         | `register_error_replies`: errors and unknown paths answered in plain text or as `{ error }`; `register_lenient_json_body`: an empty body as no arguments and bad JSON as `BAD_JSON`, for the route to refuse in its own words, or refused with 400 before any route runs with `refuse_bad_json`; `send_text`. |
| `server/config`                          | `read_server_config`: host, port, web folder and the app's options from flags, then the environment, then defaults, with usage text for `--help`, the secret from `<PREFIX>_TOKEN_FILE` or `<PREFIX>_TOKEN`, and no listening beyond this machine without one; `read_secret_file`. |
| `server/declared_tokens`                 | Tokens declared in the app's config, so a scraper's token can live in a NixOS config: `read_declared_tokens` reads each entry's name, its `token_hash` (`sha256:<hex>` from `token_hash`), `token_file` or plain `token`, and a scope the app maps onto a role, read-only or not, or onto no role for a token only the app's own routes check, optionally limited to some of the app's items; bad entries are skipped and explained. Given to `AccountStore` as `declared_tokens` (or `set_declared_tokens` after a reload), they sign in with `server/account_sign_in` as their scope's role, cannot be revoked from the page, and `check_declared_token` finds the role-less ones. |
| `config_watch`                           | `watch_config`: re-reads a config file when it changes, checking a fingerprint of what its path points at (symlinks followed, inode, change time, size) every few seconds, waiting one more check for it to hold still, and reloading only when the content's sha256 differs from what was loaded; a failed reload is reported and the watch goes on. |
| `server/prometheus`                      | `render_metrics`: metric families in Prometheus' text format, with HELP and TYPE lines, labels in order, names made valid, label values and help escaped and infinities written as the format asks; `metrics_content_type`. |
| `server/mqtt_discovery`                  | Home Assistant's MQTT discovery: `slug` for topic levels and ids, `discovery_topic`, and `reading_traits`, the device class and unit a reading's name implies, such as `_bytes` or `_temp_c`. |
| `server/notify/*`                        | Notification channels, each a settings reader that throws in plain words and a sender that throws when delivery fails: `ntfy` (topic, priority by name or 1-5, tags, a link to open, token or name and password), `webhook` (JSON or a `{name}` template, as text when it is a string, with headers and a bearer token), `mail` (SMTP on nodemailer, an optional peer, over STARTTLS, TLS or none), `apprise` (the `apprise` program, its URLs passed in the environment, never on its command line); `settings` reads a secret inline or from `<key>_file` and a setting given once or per kind. |
| `server/notify/channels`                 | `read_channels`: the channels in a config list, each picked by its `type` (`ntfy`, `webhook`, `mail` or `apprise`) and read at once so a mistake stops the app starting, named by the list's key; `Notifier` sends a notification (title, body, level) to all of them, a failing one logged while the rest still get it; the level sets ntfy's priority and Apprise's type. |
| `server/mcp`                             | `register_mcp_route`: the calls an `api_spec` describes, served as MCP tools over the official SDK's streamable HTTP (`@modelcontextprotocol/server`), each marked read-only or not, and destructive when its spec says `destructive: true`, as a call that deletes does, a call whose spec says `page_only: true` left out and a use the `page_only` rule names (from `page_only_calls`) refused, its arguments checked against the schema, its result as JSON text and a failure as a tool error in the call's own words; a read-only token runs only the tools that read, and a scoped one its scope's calls too; it sits behind the app's sign-in like any other API path. `route_tools` offers a REST app's routes the same way, running each route inside the app with the caller's headers and address, so it is signed in and checked exactly as the page's request is. |
| `server/cors`                            | `register_open_cors`: any origin may call the API, as a native or mobile shell does from a page of its own, with the client id header allowed. |
| `web/dom`, `web/format`, `web/router`, `web/theme` | The page's element builder and `cx` class joiner, formatters (including `compact_count`, such as `"1.4M"`, and `format_count`, such as `"60,000"`), hash router and theme choice, kept in this browser or the app's settings, and `follow_host_theme` for taking a host page's colours, such as the Linux sidebar's. |
| `web/sqlite_wasm`                        | `open_wasm_database`: SQLite in WebAssembly for a page that keeps its own database, such as a phone app, saved whole to IndexedDB through `indexed_db_files` shortly after each change; `indexed_db_files` with `has` also keeps synced files. |
| `web/pictures`                           | `shrink_picture`: a picture file or data URL redrawn at most 480 pixels on its longest side, or another limit, as a WebP data URL small enough to store and sync, such as a photo from a phone's camera. |
| `web/markdown_text`                      | `as_code_block` and `code_fence`: text as a fenced code block whose fence outruns any backticks inside it, with no page needed, such as for a database upgrade. |
| `web/states`, `web/tables`, `web/menus`, `web/split`, `web/errors` | `LoginNeeded`; sorting by several columns, trees and column order; for rows of plain objects, the same on a server and in the page, `sort_rows` (numbers before text, natural order, empty cells last), `filter_rows` on every typed word, `next_sort_keys` for header clicks, `keyed_rows` from contents and `tree_rows` by a parent field; menu items, placement and keys; pane sizing; `describe_error` for anything thrown, such as shaka's coded objects, and `describe_call_error`, the same without Electron's remote-method prefix, for a failed call shown to the user. |
| `web/api`, `web/events`                  | `create_api`: JSON calls whose 401 throws `LoginNeeded` except on open paths such as the login, whose refusals throw `ApiError` in the server's words (a proxy's HTML error page, such as a 504, in plain ones), with headers read afresh per call; `follow_changes`: the page's side of `EventStream`, a watch bumped on each change and after a reconnect, and the client id to send back. |
| `web/tree`                               | Rows with `parent_id` and `position`: nesting, subtrees, tree order, paths, and where a dropped or keyed row lands, its siblings ordered by position or, with `by_list_order`, as the list gives them. |
| `web/watch`, `web/react/watch`           | `create_watch`: a change counter a store bumps; `use_watch` redraws only the components that read that store; `coalesce_bumps` lands a bump at most once per interval, for streamed tokens. |
| `web/store`, `web/react/store`           | `create_store`: a value with a watch, set or updated, redrawing at a steady pace when `coalesce_in_milliseconds` is given; `use_store` reads it. |
| `web/prefs`, `web/react/prefs`           | Remembered view settings that read as their default when stored corrupt, stale or of the wrong shape; `use_pref` keeps one as component state. |
| `web/selection`, `web/virtual`, `web/drag` | Picking rows with plain, Ctrl and Shift clicks from a fixed anchor, or as lists of ids with the anchor kept by id, the row an arrow or page key moves to; which rows of a long list a viewport needs; a badge such as "3 tasks" as the drag image. |
| `web/react/shell`                        | `Shell`: top bar with the brand and its icon and the app's `tools`; section links, or, once a section has `children`, a `SectionTree` of section rows folding open onto their items on `Tree`, the folded ones kept in the `sections_pref` pref and a folded section lit up in place of its hidden `active_item`; or the app's `views` as rows with their icons (from `web/react/icons`) in the sidebar's navigation, the one `active` names raised and marked as the current page, above the app's own sidebar in a `.sidebar-content` box, the sidebar then an aside so the views are its only navigation landmark, or that sidebar alone, scrolling above a foot pinned to the sidebar's bottom that holds the app's `sidebar_foot` rows, then the theme, the signed-in `user` linked to `user_href` with Sign out, and `settings` last; resizable; a `side_pane` docked on the right beside main ([A pane on the right](#a-pane-on-the-right)), its open state kept by `use_side_pane` in a pref; `brand_logo` for a full logo that already holds the name, drawn alone in its place; a `status_bar` at the foot of the window, toasts, dialogs and menus, with or without logins (no account row without a `user`, `logged_out` hiding the sidebar and tools), its phone menu held by the Shell or the app, and for app-like pages a `contained` window where only main scrolls and the brand heading the sidebar; `labels` for its own words in another language; `ThemeRow`, the theme as a sidebar row, `ThemeButton`, as an icon button, both drawing the system theme on a server and until the page is picked up, and `use_route`. |
| `web/react/layout`, `badges`, `states`   | `PageHeading` with a subtitle, icon, banner, actions and a `level` for inside dialogs and panels; panels (`Section`, with a `level` for one inside a dialog or under another heading), `GroupSections`, a panel per group from `group_items` headed by its name and count, facts, tiles, cards, tabs, `Crumbs` with chevrons between steps that link, run a function or mark where the reader is, `PathText` for a path shown with the same chevrons, steppers, `FormRow` for a form's labelled fields, `FormGroup` folding part of a form under a summary line such as "More options", `SettingsPage` with an `Outline` beside its sections, settings rows, `RowActions` and `moved` for ordered lists, `SelectionBar` for picked rows, their count with its thousands separated; badges, `StateBadge` naming each state's text and tone and `ToneBadge` showing the state's own name in its tone, chips in an item's own colour, dashed or removable, `ColorDot` and `StatusPill`, a state dot with text and an action; `use_resource` with its `status` (idle until `enabled`, loading, loaded, failed), a `watch` that reloads it quietly, and its loading states, `Loaded` going by the status so a null result shows its `empty` slot or the children. |
| `web/react/sync_settings`, `backup_settings` | The settings rows every device shows: `SyncSettings`, the sync status and who the device syncs as, or the server's address, name, password and the code when asked, choosing which copy wins after a confirm; `SyncButton`, the same status as a sidebar row with the changes waiting, syncing on a click or opening the settings when sync needs the user or is not set up, and shown even while it is not; `BackupSettings`, back up now, the daily schedule, and each backup to restore or delete after a confirm. |
| `web/react/connections`                  | `ConnectionSettings`: the Connections section of Settings, every daemon the app can talk to with the one in use marked Connected, Connect to switch, Rename and Remove (after a confirm) for daemons on other hosts, and a form to add one by address, name and password, asking for the code when the daemon does and offering to trust a certificate the device refuses given `certificates`. |
| `web/react/certificates`                 | `CertificateDialog`: what is wrong with a server's certificate in plain words, the certificate itself with its fingerprint, and Trust or Don't connect; `offer_certificate_trust` and `ask_to_trust_certificate` open it from anywhere, `with_certificate_prompt` wraps a fetch to ask and retry once, `SyncCertificatePrompt` asks whenever sync fails over the certificate, `SyncSettings` asks when connecting does given `certificates`, and `TrustedCertificates` lists them to forget. |
| `web/react/time`                         | `Age`: a time as how long ago, with the full stamp on hover; `use_now`, the time read again each minute; `use_countdown`, a countdown on a wall-clock deadline, so a page that slept shows the time really left, with start, stop, pause, resume and extend and a callback once at zero. |
| `web/accounts`                           | `create_accounts_client`: the page's calls to `server/account_sign_in`, from the page itself or, given the server's address as `base`, from a desktop or phone app, which signs in with `sign_in_device` and keeps the token; `SignInRefused` says when only the code is missing. |
| `web/react/sign_in`                      | `SignInForm`: name, password, the code when asked, "Keep me signed in" and the single sign-on button; `use_account`, the account the page is signed in as, checked at start and lost whenever a `LoginNeeded` goes unhandled. |
| `web/react/accounts`                     | `AccountView`, "Your account": password, second factor, where you are signed in with Sign out, and your tokens, made full, read only or kept to one of the app's token scopes; `UsersView`, the admin's users with roles, access, second factor resets and Sign out, and every token, and `users_settings`, the same as Users and Tokens sections of the settings page, none for anyone but an admin; the app gives `role_text`, `access_text` and an `access_editor`. |
| `web/react/login`                        | For apps not yet on `web/react/sign_in`. `LoginForm`, the name and password form; `use_session`, the page's session checked once at start and lost whenever a `LoginNeeded` goes unhandled; they pair with `server/password_sign_in`. |
| `web/react/reveal`                       | `use_reveal`: a long list shown a page at a time, the next page added as its end scrolls into view, starting from the count shown before the page was left if given. |
| `web/react/media`                        | `Avatar`, a round picture or the name's first letter; `Cover`, an album's or film's picture filling the width it is given, or Halon's 48, 96 or 160 pixels by `size`, at an `aspect`, holding its place while its `src` is undefined and showing the app's `placeholder` when there is none or it fails to load, with `cover_source` reading a `use_resource` that finds it, so a slower earlier answer never replaces a newer cover; `MediaTile` and `MediaGrid`: videos, albums or playlists as tiles in a grid or as rows, Halon's small, medium or large tiles by `size` (`media_grid_sizes` for a setting), `GroupedMediaGrid` putting them in groups from `group_items` under headings with their counts, with text over the picture's corner such as a length, lines under the title, a faded look, buttons in the corner, and `on_open` to open a tile in place, such as in a dialog, while its link still opens a new tab. |
| `web/react/menu_button`                  | `MenuButton`: a ⋮ button that opens a menu under itself, even inside a link, saying through `aria-expanded` whether it is open. |
| `web/react/icons`                        | `Icon`: a line icon as Halon draws them, on a 24px artboard with a 2px round stroke in `currentColor`, at `--icon-size-small` or, with `size="large"`, `--icon-size-large`, turning with `spinning`; hidden from screen readers unless given a `label`, then an image of that name. The glyphs come from Lucide (`lucide-react`, ISC), chosen because its icons are drawn to exactly that grid, and each is its own export, so a page bundles only those it uses: `PlayIcon`, `PauseIcon`, `StopIcon`, `PreviousIcon`, `NextIcon`, `ShuffleIcon`, `RepeatIcon`, `RepeatOneIcon`, `MuteIcon`, `QueueIcon` and the other player marks, `AddIcon`, `CloseIcon`, `DeleteIcon`, `EditIcon`, `SearchIcon`, `SettingsIcon`, `MoreIcon`, the chevrons and arrows, `CheckIcon`, `WarningIcon`, `ErrorIcon` and more; any other Lucide icon the app imports works too. |
| `web/react/test_stubs`                   | Stands in for `showPopover`, `hidePopover`, `showModal`, `close`, `matchMedia`, `scrollTo`, `ResizeObserver` and text's `getClientRects`, which jsdom lacks; an app's widget tests import it for its side effects, and a node test's shared setup may import it too. |
| `web/react/list_picker`                  | `pick_list_dialog`: adds one thing to any of the app's lists, such as a video to playlists, ticking the lists that hold it and making a new one. |
| `web/react/emoji_picker`                 | `EmojiPicker` on Frimousse, searchable, grouped and worked by keyboard, its Emojibase list bundled in a chunk of its own so it works offline; `EmojiField`, a button showing the chosen emoji that opens the picker under itself, with a clear button. |
| `web/react/controls`, `table`            | Segmented choices, button groups, switches with their label beside them on `show_label`, search boxes that hand on typing as it pauses, submit on Enter or a button, clear on Escape, can take a paste whole, take focus and follow a value cleared from outside, selects with option groups, `CommitInput`, `NumberField` stepped with − and + or the arrow keys, typed with a phone's number keys and kept within its limits, `DateTimeField`, `PeriodStepper` stepping a day or month back and forward, picking one or returning to the current one, `PathInput` with a Browse button on the app's picker, `ColorPicker`, `TreeSelect` opening an indented card that shows the picked path, `TreePicker` searching a tree as it is typed into, matches shown under their parents, offering the typed text as a new item with `on_create`; `DataTable` on TanStack Table, sorting by several columns, filtering by typed words, grouping by a column's values and hiding columns from a Columns button on its own unless the app takes them over (`column_hiding={false}` leaves the button out), with columns to move, resize, hide and filter from buttons pinned over the heading band, a `header` such as an icon shown in place of a column's label, tree rows, groups under headings, rows the app drags and styles, rows that come sorted from a database, rows worked by keyboard, rows that draw again only when they change, `virtual` rows drawn only where they show, spaced by a drawn row's measured height when the app gives none, a last column that fills the room left, group headings that hide when the filter empties them, a `wrap_class` for Halon's `scroll`, `fit` and `sticky-head`, `single_line` rows one line high with an ellipsis, and cards on phones, under the table's buttons on a line of their own; a pager. |
| `web/react/facet_pane`                   | `FacetPane`: the values of one field with how many items hold each and an All row, picked to narrow a list by plain, Ctrl and Shift clicks or by keyboard as a listbox (arrows, Home, End and pages walk it, Space or Enter picks, Shift stretches from the anchor, Ctrl+A takes every value, Escape goes back to All), one at a time unless `multiple`, its loading, failure and empty states, and `virtual` rows for long lists such as every artist, laid out as Halon's `scroll-pane` filling the height it is given with the head kept in view; `facet_pick` is the picking rule alone. |
| `web/react/board`, `phone`              | `Board`: a board of fixed-width columns under small caps heads with their counts, plain like a kanban or split into `lanes`, each with a head that stays in view sideways and an outlined `current` column, grouped by `group_items` under headings that fold; each cell holds the app's `render_cell` content or its `cards` (many per cell, opened by a click or Enter, with the app's class, style and context menu), moved between columns by dragging (the card lifting for the browser's picture, a dashed outline only where `can_move` and the column's `accepts_drop` allow) or with Alt and the arrow keys; worked as a grid by keyboard (arrows walk heads, cells and cards, Home and End, Ctrl for the board's ends, Enter opens, Left and Right fold a group), a skeleton, failure with Retry or empty state in place of an empty board, and on phones a list of lanes with their filled cells under the column names, or a plain board's columns one under another, those holding nothing left out with `phone_hide_empty`, whose cards still drag onto the columns or cells that take them (an empty one showing while a card is dragged) or out of the board, and move to the previous or next column with Alt and any arrow key; a `class_name` for its box, such as Halon's `fills`, or `inset` for a board that is its own surface. Drag and drop is the browser's own, as in `Tree` and `DataTable`, so a phone's touch does not drag cards. `use_phone`: whether the page is phone-sized, as the widgets' phone layouts go by, and `use_media_query` for any other media query, both read again as the window changes. |
| `web/react/card_grid`                    | `CardGrid`: cards in a grid the reader arranges, each dragged by its handle or moved with the arrow keys on it and resized from its corner or with Shift and the arrows, the others moving out of the way and every card floating up to fill the gaps; the places are plain data (`CardPlace`: column, row, width and height in cells) the app saves from `on_places_change`, a card without one placed in rows below the rest by `place_cards`, and a phone shows the cards in a column in reading order. On react-grid-layout (MIT), chosen over Gridstack because it is React through and through and keeps the layout as plain data, matching dragging, resizing and compacting feature by feature; X-Libs adds the keyboard path (`step_card`, `step_of_key`), the phone layout, placing new cards and Halon's markup. |
| `dashboard`, `web/react/dashboard`      | Dashboards a person builds from the data an app offers, like a small Grafana: the app describes its data sets (`DataSet`, plain rows with text, number and time fields, their order, names, colours and number formats) and `run_card` works a `ChartCard` out in memory, narrowed by a `filter` tree and a period, grouped by a field or by hours, days, weeks or months, split by a second field and measured as a count, sum, average, lowest, highest, distinct count or latest value; `fitting_views`, `card_problem`, `settle_card`, `flat_filter` and `clean_dashboards` for saved ones read back from anywhere. `Dashboards` draws them: named dashboards as tabs that are added, renamed, copied, reset to the app's `new_dashboard` and deleted; each a `CardGrid` arranged once Arrange is on, with an Add card menu of a chart and the app's ready-made cards (`ReadyCardKind`), each card's menu to edit, copy, remove and on a phone move it up or down; a chart editor with plain conditions joined by all or any of them, grouping, measure, order and only the views that fit, over a live preview; a chart drawn as a number, bars, stacked bars, lines, a donut, meters (each a share of the largest group), a treemap or a table, in a field's own colours or Halon's series; each data set (`DataSource`) loaded once from the earliest moment its cards need and again on `refresh`, each card with its own loading, empty, failed and problem states and a card that throws kept in its place. The dashboards are plain JSON the app saves from `on_change`. |
| `web/react/merge_grid`                   | `MergeGrid`: records to merge into one side by side, a column each with its heading, a Survivor button and Take all from this, a row per field and a Result column; the survivor's column marked with Halon's `picked-column`; where the records disagree each value is a `cell-button` that wins the field, a field with `combine` offers Keep all and keeps all by default, the rest go to the survivor, the arrow keys move between the buttons and `only_differences` hides the fields that agree; `merged_values` gives what each field ends up with for the app to save. |
| `web/react/outcome_log`                  | `OutcomeLog`: what happened to each item of a run, such as each file of a scan or each row of an import, on `DataTable` with `virtual` rows: a `StateBadge` per outcome, the item and why on one line each, cut off with an ellipsis and whole in their hover text, a filter of the outcomes that happened with their tallies, held by the log or the app, and a Follow switch keeping the newest in view while entries arrive until the reader scrolls up; its scrolling box takes Halon's `following-output` height unless `wrap_class` gives another. |
| `web/react/shortcuts`                    | `use_shortcuts` for keys such as `"mod+z"`, quiet while typing or while a dialog or popover is open; `describe_keys` for help text. |
| `web/react/tree`                         | `Tree`: nested rows that fold, walk with the arrow keys, reorder by dragging or with Alt and the arrow keys, show several picked, and take drops from outside; `has_children` gives a row a fold button before its children are listed, so an app can load them once it opens, such as in a large graph. |
| `web/react/toasts`, `dialog`, `menus`, `split` | Toasts with a link or Undo that say how they closed, and `undoable` actions that commit or undo exactly once; modal dialogs with a subtitle, header actions, a full-window size and a `form` whose submit button sends it, and confirm and text dialogs, openable from anywhere; context menus and popovers worked by keyboard, openable from anywhere, their keep-open items ticking at once; resize handles and splits. `SettingsDialogRow` is a settings row with a name, a short status and an Open button whose dialog holds that group's settings. |
| `web/react/page_view`                    | `PageView`: a full-window page over the app on the Dialog, such as Settings or an item's properties, with a Close button, actions beside it and section tabs that stay put while the body scrolls. |
| `web/react/charts`                       | `LineChart` of readings over time as lines or dots, with dashed limits such as a goal, a scale from zero or fitted around the readings, and dots from a single reading; `moving_average` for its trend line; `BarChart`, naming each bar under it when asked, `StackedBarChart`, `Meters` with ticks and a lighter fill behind, `Donut` with its headline in the middle, `Timeline` of spans and instants per lane, `Sparkline` from zero or fitted to its readings, a pass/fail `Strip`, a `Gauge` ring beside a stat's value that can link like a `Tile`, a `DonutTile`, a stat tile drawn as a full ring with its value in the middle, a `ShareBar` with each part's value in its legend, and a `Treemap` of tiles sized by value on `squarify` that hands back the one clicked: small charts colored from Halon's tokens. |
| `web/react/graph`                        | `GraphView`: a graph of nodes and links drawn by force, such as a knowledge graph: each node a shape and colour role by its `kind` (`GraphKind`: Halon's accent, a status or a `--series-*` token, read again when the theme changes), with an optional glyph and drawn faded when asked; each link solid or `dashed`, with an arrow when `directed` and a label shown near the selection or zoomed in. Selecting a node rings it and lights its neighbours; a click selects, a double-click opens (`on_activate`), a link click calls `on_link_select`; dragging pans, the wheel zooms, Fit, + and − in the toolbar beside the app's own `tools`; `focus_id` centres on a node, such as one a search found; a legend of kinds and link styles, an empty state, and every node with its links as a `Tree` under the drawing, so it is all reachable from the keyboard (arrow keys pan the drawing, + and − zoom, 0 fits, Enter opens the selection). On force-graph (MIT), loaded only when a graph is shown, which keeps a few thousand nodes moving on a canvas; X-Libs adds Halon's colours, the list, the keyboard path and selection. |
| `web/react/flow_map`                     | `FlowMap`: how things flow across columns, such as folders through jobs to repositories or flakes through caches to hosts: boxes in columns, optionally inside group boxes such as a host, joined by curved lines colored by tone, each column ordered by where its lines come from; hovering or focusing a box lights everything upstream and downstream of it, dragging pans and Ctrl or ⌘ with the wheel zooms; `use_flow_map` keeps the zoom across a remount and `FlowMapZoom` draws the zoom and Fit buttons for a section heading. |
| `web/react/progress`                     | `ProgressBar`: a bar with its value out of a max, busy while the amount of work is unknown, and words or the percentage beside it. |
| `web/react/rating`                       | `Rating`: stars that show a rating or take one by click or keyboard, with unrated kept apart from none. |
| `web/react/volume`                       | `VolumeButton`: a speaker button, a line icon showing how loud it is, that opens a slider; scrolling over it adjusts the volume and a middle-click mutes. |
| `web/react/following`                    | `use_follow_tail`, `FollowingOutput` and `FollowToggle`: output that keeps its newest lines in view as they arrive unless the reader scrolled up, with a Follow switch. |
| `web/react/events_list`                 | `EventsList`: a log of what happened, each row the event's age, its level as a badge (`LevelBadge`, in any case, so "WARNING" and "warning" match), the app's own part such as a link, and the message; an entry without a time, such as a message from the last check, shows none; `empty` for what shows when there is nothing. |
| `web/react/jobs`                         | Jobs an app runs on its own: `JobsTable` links each to its page, with what it is for when `owner` is given, its `JobBadge`, when and by whom it started and its last line; `JobDetails` shows one job's facts with the app's own, its error, a slot for progress, its command and its output followed while it runs; `StopJobButton` asks before stopping. |
| `web/react/markdown`                     | `Markdown` and `render_markdown` on marked and DOMPurify, chosen because marked covers the hand-written parser feature for feature and adds tables and nested lists: raw HTML shows as text, only web links are clickable and open in a new tab, and `follow` keeps streamed text in view. |
| `web/react/outline`                      | `Outline`: a long page's sections in groups under headings, such as an article's headings or a settings page's sections, each link jumping to its section, the one being read marked as the page scrolls, deeper ones indented by `data-level`, and the section put in the address with `update_hash`. |
| `web/react/search_dialog`                | `SearchDialog`: results that come in as the reader types, a pause apart, each page with its matching sections under it, worked with the arrow keys and Enter as a combobox over a listbox, excerpts keeping only their `<mark>`s; `SearchButton`, a field-like button that also opens it from Ctrl+K (Cmd+K) or "/". |
| `site/*`, `web/react/site`, `web/site/*` | A static site for GitHub Pages in the X-apps' frame: see [A static site](#a-static-site). |
| `web/react/rich_text`                    | `RichText`: a formatted text field on Tiptap that reads and writes Markdown, chosen because Tiptap ships no look of its own, so its toolbar is Halon markup, and its Markdown extension keeps the stored text plain: bold, italic, strikethrough, code, headings, lists, checklists, quotes, code blocks and web links, `on_change` only for typing, never for showing a value. |
| `web/react/suggestions`                  | `Suggestions`: completions under any text field from a sync or async source; arrow keys choose, Tab or Enter take, Escape dismisses, other keys pass through; `open_on_focus` lists them once the field is entered, nothing lit, so Enter still hands on free text. `ComboField`: that mode over known values, every one listed on focus and narrowed as typed. |
| `web/react/chip_field`                   | `ChipField`: values as removable chips with a `ComboField` that suggests those not yet chosen and an Add button; `with_draft` takes in a value still in the field when a form saves; `TreeChipField`: items of a tree as chips showing their paths, with a `TreePicker` to add one or, with `can_create`, new text. |
| `web/react/recurrence`                   | `RecurrenceField`: a rule or its iCalendar lines edited as Halon fields, with a Repeats switch, every N seconds to years, weekdays, months, several days of the month and weekday entries such as "the last Friday", "only the last of those", several times of day or minutes past, an end after a count or on a date, dates to skip and add, and every `BY` part and `WKST` under More options; `features` from `simple` to `full` with names added or taken away, read by `read_features`; it describes the rule below, keeps what it cannot edit as written, and blocks its form while a field or the value cannot be read. |

```ts
import { AgentHub } from "@x-tech-laboratories/x-libs/server/agents/hub";
import { parse_duration } from "@x-tech-laboratories/x-libs/durations";
```

## A web app's server

The server modules are small Fastify pieces an app registers one by one, so each app keeps only what it needs.

```ts
const config = read_server_config({
  program: "x-tasks-server", summary: "Serves X-Tasks as a web app.", env_prefix: "X_TASKS", default_port: 3918,
  web_folder_default: join(import.meta.dirname, "../web"),
  options: { database: { variable: "X_TASKS_DB", help: "the task database; it is made if missing", placeholder: "<file>", required: true } },
});
const app = fastify({ forceCloseConnections: true });
register_lenient_json_body(app);
register_error_replies(app);
await register_token_sign_in(app, { secret: config.secret, title: "X-Tasks" });
const changes = new EventStream();
await app.register(async (api) => {
  await register_open_cors(api);
  changes.register(api, "/events");
  api.post("/add", async (request) => { ...; changes.announce_change(changes.client_id_of(request)); });
}, { prefix: "/api" });
await register_web_folder(app, { folder: config.web_folder });
```

Other programs reach the same calls once they are described in an `ApiSpec`: as MCP tools, and as an OpenAPI
document for everything else. Both sit behind the sign-in, so a client sends the secret as a bearer header. A read-only token of
`server/account_sign_in` runs only the tools that read; list the MCP path in `read_only_paths` so the guard lets its
POSTs through.

```ts
const api: ApiSpec<TasksMethods> = {
  list_tasks: { description: "Lists the open tasks.", params: [] },
  add_task: { description: "Adds a task.", params: [{ name: "title", schema: { type: "string", minLength: 1 } }] },
  remove_task: { description: "Removes a task.", params: [{ name: "id", schema: { type: "string" } }], destructive: true },
};
await app.register(async (scope) => {
  await register_mcp_route(scope, { name: "x-tasks", version, api, is_read_only, call: (method, args) => methods[method](...args) });
  scope.get("/openapi.json", async () => openapi_document(api, { title: "X-Tasks", version, path_of: (method) => `/api/call/${method}`, is_read_only }));
}, { prefix: "/api" });
```

An app built on REST routes names the route each tool runs instead of writing `call`. Each `:name` in the path takes
the argument of that name, and the rest go in a GET's query or in the JSON body; a GET only reads. As every route
checks the caller itself, the MCP path needs only someone signed in.

```ts
const routes: Record<string, RouteToolSpec> = {
  get_host: { route: "GET /api/hosts/:name", description: "Shows one host.", params: [{ name: "name", schema: { type: "string" } }] },
  refresh_host: { route: "POST /api/hosts/:name/refresh", description: "Reads a host again now.", params: [{ name: "name", schema: { type: "string" } }] },
};
await app.register(async (scope) => register_mcp_route(scope, { name: "x-nix", version, ...route_tools(app, routes) }), { prefix: "/api" });
```

An app with its own sessions, such as one logging in by name and password, uses `register_sign_in_guard` with its
own `is_signed_in`, `login_path: null` so its page loads and logs in itself, and `refusal: "json"`.

## Items for other apps

Every app answers the same four read-only calls about the items it holds, as the Application Standard asks, so a
program such as an assistant reads every app with one piece of code. `item_calls` takes the app's own answers and
gives the four methods and their `api_spec` entries, to spread into the method table and the spec, so they are served
over the API, OpenAPI and MCP like every other call; their names start with `list_`, `search_` and `get_`, so an
`is_read_only` that goes by the name marks them read-only.

```ts
import { history_item_changes, item_calls } from "@x-tech-laboratories/x-libs/items";

const items = item_calls(
  {
    kinds: [{ kind: "task", label: "Task" }],
    search: (query, limit) => search_tasks(database(), query, limit).map(task_item), // best first
    get: (ids) => tasks_by_id(database(), ids).map(task_item),                       // gone ones left out
    changes: history_item_changes([{ kind: "task", history: task_history, item: (task) => ({ title: task.title, snippet: task.notes, status: task.done ? "done" : "open" }) }], database),
  },
  { scheme: "x-tasks" },
);
const methods = { ...task_methods, ...items.methods };
const api: ApiSpec<typeof methods> = { ...task_api, ...items.api };
```

An item the app hands over needs its `id`, `kind`, `title` and `changed_at`; its `link` is made from the scheme, kind
and id unless given, its `snippet` is put on one line and cut to 200 characters, and `status` and `detail` are empty
unless given. A search or a change list takes 20 items unless told (`default_limit`) and never more than 100
(`max_limit`), and `get_items` takes at most that many ids. `list_item_changes(since, limit)` gives the items changed
after `since`, oldest first, and every change at the same moment as the last one given, so a caller that keeps the last
`changed_at` and passes it next time misses nothing. From history, each item comes once, as its newest version has it,
and a deleted one as its `id`, `kind`, `is_deleted` and `changed_at`; an item whose versions are pruned is no longer
listed. An app whose ids are only its own within a kind sets `id` on the kind, such as ``(item_id) => `book:${item_id}` ``.

An app whose items hold more text than their snippet, such as a task's notes, gives `text` too. `item_calls` then adds
`get_item_texts(ids)` and its spec, and `list_item_kinds` says `has_text` for each kind, true where the kind declares it:

```ts
const items = item_calls(
  {
    kinds: [{ kind: "task", label: "Task", has_text: true }],
    // ...search, get and changes as above
    text: (ids) => tasks_by_id(database(), ids).map((task) => ({ id: task.id, text: task.notes, format: "markdown", changed_at: task.changed_at })),
  },
  { scheme: "x-tasks" },
);
```

Each text comes back as its `id`, `text`, `format` (`plain` unless the app says `markdown`; the app turns its own HTML
or rich text into one of them), `changed_at` and `is_truncated`, true when the text was cut to 256 KB of UTF-8 at the
end of a character (`item_text_max_bytes`). Empty texts, ids not asked for and repeats are left out, and the call takes
no more ids than `get_items`. An app without `text` keeps its four calls as they were. The text leaves out keys and
passwords for other services, like everything else the API returns.

Another app reads these calls with `item_client`:

```ts
import { item_client } from "@x-tech-laboratories/x-libs/item_client";

const tasks = item_client({ name: "X-Tasks", address: "https://tasks.example.org", token });
const kinds = await tasks.list_item_kinds();
const changed = await tasks.list_item_changes(last_seen, 100);
const texts = await tasks.get_item_texts(changed.map((change) => change.id)); // null if X-Tasks does not answer it
```

`item_link("x-tasks", "task", "a/1")` is `x-tasks://task/a%2F1`, and `parse_item_link(link, "x-tasks")` gives back
`{ scheme, kind, id }`, or null for a link of another app or anything that is not an item link.

## Accounts

Every app whose users sign in uses the same accounts: `register_accounts` on the server, `SignInForm`, `AccountView`
and `UsersView` on the page, and "Sign in" and "Sign out" in its words. A desktop or phone app syncing with a server
signs in once as a device and sends its token from then on.

```ts
const accounts = new AccountStore({
  database, app_name: "X-Tasks", roles: ["viewer", "editor", "admin"],
  declared: load_accounts("X_TASKS_PASSWORD_HASH_FILE"),
});
await register_accounts(app, {
  accounts, cookie_name: "x_tasks_session", oidc: oidc_settings && new OidcClient(oidc_settings),
  needed: (method) => (method === "GET" ? "any" : { role: "editor" }),
});
```

On the page, the Shell shows the name, linked to "Your account", and Sign out:

```tsx
const client = create_accounts_client();
const { account, refresh, sign_out } = use_account(client);
if (account.state === "signed_out") return <SignInForm client={client} title="X-Tasks" on_signed_in={refresh} />;
```

Sign-in has three limits. One name from one address gets 5 tries in 5 minutes; one address gets 20 failing or
running sign-ins in 5 minutes whatever names it gives, a right password given back, so a household behind one router
is not locked out by its own sign-ins; and a user gets 5 wrong codes, and 5 wrong current passwords, in 5 minutes from
anywhere. Password hashes run off the main thread, two at once with eight waiting, and a sign-in beyond that is told to
come back with 429 and Retry-After rather than queued. Every refusal is `{ error }`, which `SignInForm` shows as it is.

The limits key on `request.ip`. Behind a reverse proxy that address is the proxy's unless the app sets Fastify's
`trustProxy` to that proxy's address, so without it every visitor shares one address's limit and one busy visitor can
lock out the rest. Trust only the proxy itself, never `true` on a server reached directly, or a client could name any
address it likes in `X-Forwarded-For`.

## A pane on the right

The Shell's `side_pane` docks a pane to the window's right edge beside main, such as a picked item's details or an
assistant's conversation, on Halon's `.side-pane` markup. Its head, the `title` as a heading (or the app's own `head`,
such as a checkbox and an editable title), the app's `tools` and a close button, sits in the top bar above the pane
on wide screens. Given `width`, shaped as `sidebar_width`, its left edge drags or takes the arrow keys, and the width
is kept under `storage_key` or by the app. Below 700px, where the sidebar becomes the phone menu, the pane covers main
instead of squeezing it, with its head at its top: it takes the screen's height below the top bar, main hidden behind
it, so a part pinned to its foot, such as an assistant's message box, stays in sight while the rest of it scrolls.

```tsx
const [assistant_open, set_assistant_open] = use_side_pane("x-codex-assistant-open");

<Shell
  ...
  tools={<button aria-pressed={assistant_open} onClick={() => set_assistant_open(!assistant_open)}>Assistant</button>}
  side_pane={{
    title: "Assistant", open: assistant_open, on_open_change: set_assistant_open,
    width: { default_width: 360, min: 280, max: 640, storage_key: "x-codex-assistant-width" },
    content: <Conversation />,
  }}
>
```

The app holds `open`: `use_side_pane` keeps it in a pref so the pane stays as it was left, and a pane that follows a
pick passes `open={picked !== null}` with `on_open_change` letting go of the pick. The close button and Escape inside
the pane, outside a text field and unless something there took the key, call `on_open_change(false)`, and focus left
in a closed pane goes back to what had it when the pane opened, else to main. The pane is an `aside` named by its
title. While `side_pane` is given, main's children sit in a `.main-pane` box and a closed pane's column takes no room,
so pass it open or closed rather than leaving it out, or main's children are drawn anew; mark a child that fills main
`.fills` rather than giving main the `fill` class. `labels.close_side_pane` and `labels.resize_side_pane` put the
buttons' names in another language.

## The page's widgets

The widgets build Halon's markup, so their look comes from Halon's web stylesheets in `@x-tech-laboratories/halon`,
which an app imports once:

```ts
import "@x-tech-laboratories/halon/halon-tokens.css";
import "@x-tech-laboratories/halon/halon.css";
import { DataTable } from "@x-tech-laboratories/x-libs/web/react/table";
import { toast } from "@x-tech-laboratories/x-libs/web/react/toasts";
```

The widgets are React components, so a page renders with React through `createRoot` from `react-dom/client`; `Shell`
holds the toasts, dialogs and menus that `toast`, `confirm_dialog` and `open_context_menu` open from anywhere. `DataTable`
is drawn on `@tanstack/react-table` with Halon's markup; its sorting, column order, widths, hidden columns and open rows
are props with change callbacks, so the app keeps them in its own settings, and a column's filter is the app's own
content in a popover X-Libs opens from the column's funnel. A table left to itself still sorts by a click, filters each
column whose cells are text by the words typed into its funnel, and groups the rows by a column picked from its Group rows
button; a column's `text` names what it shows when its cell is not plain text, and `sortable`, `filterable` and
`groupable` set false leave a column out. A request whose session has lapsed
throws `LoginNeeded` from `web/states`, and `use_resource` passes it on as an unhandled rejection, which the page's
login listens for.

## Shortcuts and trees

```tsx
import { use_shortcuts } from "@x-tech-laboratories/x-libs/web/react/shortcuts";
import { Tree } from "@x-tech-laboratories/x-libs/web/react/tree";

use_shortcuts([
  { keys: "mod+z", run: undo },
  { keys: "escape", run: clear_picks },
]);

<Tree items={tags} label="Tags" render_item={(tag) => tag.name} collapsed={collapsed} on_collapsed_change={set_collapsed}
  on_move={(tag, { parent_id, position }) => move_tag(tag.id, parent_id, position)} />
```

A shortcut stays quiet in text fields unless it has `when: "always"`, and while a dialog or popover is open unless it
has `over_overlays: true`. The tree builds Halon's `.tree` markup; a row dropped onto its top or bottom quarter lands
beside it, and onto its middle inside it.

## Plugins

```ts
import { create_plugin_host, define_plugin, json_plugin_storage } from "@x-tech-laboratories/x-libs/plugins";

// The app says what plugins may reach, once, in its shared types.
interface TasksApi {
  hooks: { "task.created": (task: Task) => void | Promise<void> };
  providers: { importer: { label: string; import(file: File): Promise<Task[]> } };
  slots: { task_sidebar: ComponentType<{ task: Task }> };
  services: { tasks: TaskStore };
}

const host = create_plugin_host<TasksApi>({
  app: { id: "x-tasks", version: APP_VERSION },
  services: { tasks },
  storage: json_plugin_storage({ get: () => localStorage.getItem("plugins"), set: (text) => localStorage.setItem("plugins", text) }),
  on_error: (plugin_id, error) => log.warn(`plugin ${plugin_id}`, error),
});
await host.add(markdown_import);                      // bundled
for (const plugin of (await load_plugin_modules()).plugins) await host.add(plugin);   // from the server's folder
await host.start();

await host.call("task.created", task);
const importer = host.provider("importer", chosen_id)?.value;
```

```tsx
export default define_plugin<TasksApi>({
  id: "x-tasks.word-count", name: "Word count", version: "1.0.0", app: "x-tasks", app_versions: "^1.0.0",
  settings: [{ key: "words_per_minute", label: "Reading speed", type: "number", default: 200, min: 50 }],
  start(context) {
    context.hook("task.created", (task) => console.info(task.title.split(" ").length));
    context.fill_slot("task_sidebar", ({ task }) => <p>{Math.ceil(task.notes.split(" ").length / Number(context.settings().words_per_minute))} min</p>);
    context.add_command({ id: "count", label: "Count words", keys: "mod+shift+w", run: count_words });
  },
});
```

```tsx
<PluginSlot host={host} name="task_sidebar" props={{ task }} />
use_plugin_shortcuts(host);
<PluginSettings host={host} />
```

Once the host starts, a plugin is off, unsupported (meant for another app or app version), running, waiting while a
plugin it `requires` is missing, of the wrong version or not running, and started as soon as that changes, or failed
when its `start` threw, tried again once it is turned off and on. Turning one off stops the plugins that require it first. To veto an action, a hook's argument carries
a flag the app reads after `call`, since a throwing hook is reported, not passed on.

A plugins folder holds one subfolder per plugin: a `package.json` with `"type": "module"` and
`"x-plugin": { "server": "dist/server.js", "web": "dist/web.js" }`, each side one bundled ESM file whose default export
is the plugin. The server and agent read it with `load_plugin_folder(folder, "server")`; the page gets its side through
`register_plugin_files` and `load_plugin_modules`, after `share_modules({ react: React, "react/jsx-runtime": jsx_runtime })`
so a plugin's components use the page's React. A web entry is imported from a `data:` URL, so a page's
Content-Security-Policy has to allow `data:` scripts for folder plugins. Folder plugins run with the app's full rights:
install only ones you trust.

## Electron apps

The bridge and window helpers describe the few parts of Electron they use, so the app passes Electron's own objects in
and X-Libs does not depend on Electron.

```ts
// shared
export const notes_bridge = define_bridge<NotesApi>("x_notes", ["list_notes", "add_note"]);
// preload
notes_bridge.expose(contextBridge, ipcRenderer);
// main
notes_bridge.handle(ipcMain, { list_notes, add_note });
create_window(BrowserWindow, {
  title: "X-Notes", file: join(__dirname, "../renderer/index.html"), dev_url: process.env.ELECTRON_RENDERER_URL,
  preload: join(__dirname, "../preload/index.mjs"), default_size: { width: 1100, height: 700 },
  state_file: join(app.getPath("userData"), "window.json"), native_theme: nativeTheme, shell,
});
// web page
window.x_notes = notes_bridge.web_rpc((method, args) => post_json(`api/${method}`, args));
```

A page that must reach another site, such as an API that sends no CORS headers, sends its requests through the main
process with `electron/fetch`. The main process allows only the hosts it lists; the page gets a `fetch` to hand to a
library.

```ts
// shared
export const media_bridge = define_bridge<{ http_fetch: FetchMethod }>("x_media", ["http_fetch"]);
// main
media_bridge.handle(ipcMain, { http_fetch: create_main_fetch({ hosts: ["api.example.com", "*.cdn.example.com"] }) });
// web page
const page_fetch = create_page_fetch((request) => window.x_media.http_fetch(request), { pinned_headers: { Origin: "https://example.com" } });
```

A server with a self-signed or private certificate is reached once the user trusts it: the main process checks and
keeps certificates with `create_certificate_trust`, Chromium honours them through `trust_in_session`, and the sync
client uses `trusting_fetch` so its requests go the same way. The page asks with `SyncCertificatePrompt` and
`SyncSettings`'s `certificates`, or `with_certificate_prompt` around any other fetch.

```ts
// shared
export const certificate_bridge = define_bridge<CertificateMethods>("x_certificates", certificate_method_names);
// main
const trust = create_certificate_trust({ file: join(app.getPath("userData"), "trusted-certificates.json") });
trust_in_session(session.defaultSession, trust.is_trusted);
certificate_bridge.handle(ipcMain, trust.methods);
const sync = create_sync_client({ ...options, fetch: trusting_fetch(session, trust) });
// web page
<SyncCertificatePrompt device={window.x_sync} certificates={window.x_certificates} />
```

The page's log lines join the main process's, so one terminal or file shows both in order, at the levels one setting
gives, such as `X_NOTES_LOG=warn,page:debug`.

```ts
// shared
export const log_bridge = define_bridge<PageLogMethods>("x_log", page_log_method_names);
// main
const main_log = create_main_log({ setting: process.env.X_NOTES_LOG, file: process.env.X_NOTES_LOG_FILE });
log_bridge.handle(ipcMain, main_log.methods);
// web page
const page_log = create_page_log(window.x_log);
await page_log.start();
const log = page_log.logger("editor");
```

`create_window` keeps the app's own pages in the window: a link or a navigation to another site opens in the browser,
and only web and mail links leave the app.

## The app and its tasks

The server and every agent are given the same `AgentApp`: the app's name, its protocol version, and its tasks.

- The **name**, such as `x-nix`, names the key login's header (`x-nix-agent-host`) and is bound into the challenge the
  agent signs (`x-nix-agent-v1|<host>|<nonce>`), so agents already deployed for an app keep logging in, and into
  everything a server key signs (see [Proving the server to agents](#proving-the-server-to-agents)).
- A **task** is what a run, a long run or a stream carries: a shell command line for one app, a typed operation for
  another. The app names the wire field it travels in and checks it. `shell_app("x-backups")` sends a string in
  `command`.
- The agent and the server's `LocalAgent` carry tasks out through a `TaskRunner`: `run`, an optional `stream`, and
  `launch`, the program a long run's process starts as. `shell_runner("x-backups-run")` runs each under `sh`.

## The app's own messages

The protocol carries run, stream, long-run and ping messages. An app adds its own beside them:

- **Requests** the agent answers: give `start_agent` and `LocalAgent` a `requests` map, such as `{ health: read_health }`,
  and ask with `hub.request(host, "health")`.
- **Messages** either way: `session.send(...)` from the agent, with `on_hello` to send once logged in; `connection.send(...)`
  from the server, with the hub's `on_message` to receive; the agent's `on_message` receives the server's.

## Proving the server to agents

An agent proves its host to the server by signing the server's nonce with the host's key. TLS alone proves the server
to the agent, so whoever can pass for the server's address, with a wrongly issued certificate or a reverse proxy that
was broken into, could send every agent tasks. A server key closes that gap: the server signs what it sends, and each
agent answers only a server holding a key it lists.

- **Server**: make a key as for an agent, `ssh-keygen -t ed25519 -N "" -C <app>-server -f server_key`, keep it with the
  server's secrets, and give the hub `server_key: parse_private_key(readFileSync(file, "utf8"))`. Its public line is in
  `server_key.pub`, and `public_line_of_private_text(text)` and `hub.server_public_line()` give it too.
- **Agent**: give `start_agent` that line in `server_keys: ["ssh-ed25519 AAAA..."]`. The agent then waits for the
  server's challenge, checks its signature over the app, the host it logs in as, the server's nonce and the key's
  fingerprint before signing anything, and says hello with a nonce of its own. With its host's key it signs the app,
  the host, both nonces and the server key's fingerprint, so its hello is good for no other connection and no other
  server. Every message the server sends afterwards comes as `{"type":"signed","counter":n,"message":"<the message's
  JSON text>","signature":"<base64>"}`, its counter one more than the last, starting at 1, and its signature over the
  app, the host, both nonces, the counter and the message's text exactly as sent. The agent refuses a message that is
  not signed, is signed wrongly or for another connection, or whose counter does not follow the last: it answers a
  request with `failed`, logs why, and hangs up with code 4009. A server that signs nothing, or signs with a key the
  agent does not list, is refused the same way, and a token login waits `challenge_timeout_in_milliseconds` (10
  seconds) for the challenge. With a token login the host the agent names must be the host the server knows the token by.
- **Old and new together**: nothing changes the protocol version. A server with a key sends its signed challenge to
  every agent, and the fields an older agent does not know are ignored; it signs messages only to an agent whose hello
  carried a nonce. An agent with no `server_keys` behaves as before and logs once that TLS alone proves the server. An
  agent with `server_keys` never answers an older server or one without a key.
- **Replacing the server key**: make the new key, add its public line to every agent's `server_keys` beside the old one
  and roll that out; switch the server to the new private key and restart it; once every agent has logged in again,
  take the old line out of the agents' `server_keys` and destroy the old key.

The agent's replies are not signed, and the key encrypts nothing: whoever terminates TLS still reads every request,
its stdin and its output, can drop the connection, and can change what the agent answers.

## A static site

`x-libs-site` builds a documentation or project site from a folder of Markdown and MDX, drawn in the same `Shell`, widgets and
Halon look as the apps, and served as plain files from GitHub Pages. It stands on established tools: Vite bundles and serves
it, MDX's own compiler reads the pages (with GitHub's tables and task lists), Shiki colours code through Halon's tokens and
Pagefind indexes the built pages for search. Each page is drawn to HTML at build time and picked up again in the browser,
so it reads without JavaScript and its search, outline, menus and theme work with it.

- **Pages**: `content/**/*.md(x)` with a `title` in the frontmatter, `index` files at their folder; `template: splash` makes a
  landing page with a `hero` (title, tagline, image, actions); `sidebar.order`, `sidebar.label` and `sidebar.hidden` place a
  page; `toc: false` hides its outline. MDX imports `Card`, `CardGrid`, `LinkCard` and `Aside` from `web/react/site`, and the
  site's own React components.
- **Sidebar**: links, pages by slug, groups and whole folders (`autogenerate`), each label with `translations`; as in a
  notes tree, a folder is a page too: its row links to its `index` page, or to a page of the same name beside it, and
  folds the pages under it from the arrow before its label, however deep; previous and next links follow its order.
- **Search**: a Pagefind index per language, its results by page and by heading; Ctrl+K or "/" opens it.
- **Languages**: `locales` by key, `root` at the top and the others under `/<key>/`; a page missing in a language is shown in
  the default one with a notice and left out of that language's search; the frame's words come in English, Spanish, French,
  German, Portuguese and Italian, and `ui` adds or overrides them; `hreflang` links tie the versions together.
- **Logo**: `logo` is an icon drawn before the title, or with `logo_replaces_title` a full logo drawn alone.
- **GitHub Pages**: `base` for a project site under `/<repo>/`, moving every link that starts at the root; `404.html`,
  `sitemap.xml`, canonical and Open Graph tags, `.nojekyll`, an "Edit this page" link and the last commit date of each page.
- **Moved pages**: `redirects` maps old addresses, such as a Jekyll site's `/guide.html`, to new ones with small pages
  that send the reader on.
- **More files**: `files` adds generated ones, such as JSON made from the site's data.
- **GitHub's own Markdown**: alerts such as `> [!TIP]` show as asides and raw HTML such as a table of pictures is
  kept, so a page reads the same on GitHub and on the site; a page with no `title` takes its opening `# heading`, which
  is then not drawn twice, so an MDX page can show a README with `import Readme from "../README.md"`; links that start at the root move under the base in Markdown and in a component's `href` or `src`.
- **Diagrams**: a ```` ```mermaid ```` block, which GitHub draws too, is drawn with [Mermaid](https://mermaid.js.org/) in
  Halon's colours and drawn again when the scheme changes; the page shows its source until then, and without
  JavaScript. The browser loads mermaid only on a site with a diagram, which adds `mermaid` to its own dependencies.
- **Pages beside a package**: the scan skips `node_modules`, `dist`, `public` and hidden folders, so a site can live in
  an app's `docs/` folder with a `package.json` of its own.

```ts
// site.config.ts
import { define_site } from "@x-tech-laboratories/x-libs/site/model";

export default define_site({
  title: "X-Example",
  site: "https://x-tech-laboratories.github.io",
  base: "/X-Example/",
  logo: "./resources/icon.svg",
  locales: { root: { label: "English", lang: "en" }, es: { label: "Español", lang: "es" } },
  css: ["@x-tech-laboratories/halon/halon-tokens.css", "@x-tech-laboratories/halon/halon.css", "@x-tech-laboratories/halon/site.css"],
  sidebar: [{ slug: "" }, { label: "Guides", translations: { es: "Guías" }, autogenerate: { directory: "guides" } }],
});
```

`x-libs-site dev` serves it with live reloading (search needs a build), `x-libs-site build` writes `dist/` and
`x-libs-site preview` serves that. The site installs `react`, `react-dom`, `vite`, `@mdx-js/rollup`, `remark-gfm`,
`remark-frontmatter`, `rehype-raw`, `rehype-slug`, `rehype-autolink-headings`, `shiki`, `@shikijs/rehype`, `unist-util-visit`, `yaml` and
`pagefind`, the optional peers the build uses, and ignores the `.x-site/` folder the build writes its entries to. A GitHub
Actions job runs `npm ci` and `npm run build` with `fetch-depth: 0`, for the dates, and uploads `dist/` with
`actions/upload-pages-artifact`.

## Change checks

`x-libs-check` runs the change checks on what changed since a base and exits 1 when any fails, printing each check's
outcome and its findings one per line:

```sh
npx x-libs-check [--base <ref>] [--repository <owner/name>] [--working-tree] [check...]
```

With no checks named it runs `commits`, `secrets`, `leftovers`, `comments`, `coverage`, `x-libs` and `dependencies`. The
base is the branch point from `origin/main` unless given; the repository comes from `GITHUB_REPOSITORY` or the `origin`
remote; `--working-tree` counts uncommitted and untracked files too. `dependencies` reads licences from `node_modules`,
so it runs after `npm ci`. The rules default to X-Tech's and change under an `"x-libs-check"` key in `package.json`,
read as it was at the base so a change cannot loosen its own checks:

```json
"x-libs-check": {
  "commit_trailer": "Assisted-by",
  "trailer_organisations": ["x-tech-laboratories"],
  "ai_mention": "\\b(claude|copilot)\\b",
  "wrapped_libraries": ["drizzle-orm", "@tiptap/"],
  "wrapping_repositories": ["x-tech-laboratories/X-Libs"],
  "allowed_licences": ["MIT", "ISC", "Apache-2.0"]
}
```

A job in an app's `.github/workflows/ci.yml`:

```yaml
  change-checks:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx x-libs-check --base origin/${{ github.base_ref }}
```

An app with checks of its own, such as a firmware build, adds them to a registry and runs the same command from its
own script:

```ts
import { create_check_registry } from "@x-tech-laboratories/x-libs/change_checks";
import { run_check_command } from "@x-tech-laboratories/x-libs/change_checks_cli";

const registry = create_check_registry();
registry.add("firmware", async (change) => ({ gate: "firmware", outcome: "passed", findings: [`built since ${change.base}`] }));
const default_checks = ["commits", "secrets", "firmware"];
process.exit(await run_check_command(process.argv.slice(2), { cwd: process.cwd(), env: process.env, out: process.stdout, err: process.stderr, registry, default_checks, command_name: "x-firmware-check" }));
```

`default_checks` are run when none are named and `command_name` heads the usage and errors. A check reads the base the
command worked out from `change.base`, the commit `read_change` resolved, so the app never works it out itself.

## Development

```sh
nix-shell        # Node 24 and ssh-keygen, which the key tests use
npm install
npm run build    # compiles src/ into dist/
npm test
npm run coverage # raises the coverage floor in vitest.config.ts; commit it
npm run lint
```

The coverage floor in `vitest.config.ts` only rises: CI fails when coverage drops below it or a raised floor is not committed.

A release is a version bump merged into `main`: the Publish workflow then publishes that version from CI with npm provenance, through npm's trusted publishing for this repository. `npm pack` and `npm publish` build first.

## License

GPL-3.0-or-later.
