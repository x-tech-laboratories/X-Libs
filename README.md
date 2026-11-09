# X-Libs

Code the X-apps share, published as one npm package, `@x-tech-laboratories/x-libs`, with a subpath per module.

## Modules

| Import                                   | What it holds                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `durations`                              | `parse_duration` for settings such as `"2h30m"`, `format_duration` in months down to seconds, `format_age`, and `format_clock` for a playing time such as `"3:07"`. |
| `log`                                    | Loggers by scope and level from a setting such as `"warn,play:debug"`; a malformed setting falls back instead of silencing logging, and a setting read through a function applies to loggers made before it arrived. |
| `dates`                                  | Local dates as `"2026-06-10"` or `"2026-06-10T09:30"`: reading, writing, adding days and months, overdue, and Yesterday/Today/Tomorrow labels. |
| `backups`                                | Named backups of an app's data in any store, newest first, with daily automatic ones kept to a set number. |
| `plugins`                                | `create_plugin_host`: plugins bundled with the app or loaded at run time, each a manifest and a `start(context)`, started in the order their `requires` need and refused when meant for another app or app version; through the context a plugin adds hooks the app calls (on hookable, chosen for its typed, ordered and parallel calls with nothing of its own to style), providers the app picks one of by id, commands with keys, slot contents and settings fields, all taken back when it stops, is turned off or fails to start; one plugin's failing hook is reported and the rest still run; on/off and settings kept through `json_plugin_storage`, stored values that no longer fit falling back to their defaults; versions checked with semver. |
| `plugin_folder`                          | `load_plugin_folder`: the plugins in a folder's subfolders, each `package.json` naming its built entry per side under `"x-plugin"`, refused when it leads outside its subfolder, with a problem per broken subfolder instead of a throw. |
| `server/plugin_files`                    | `register_plugin_files`: `/plugins/index.json` lists the folder's web entries, read afresh on each request, and each plugin's own files are served from its subfolder and nowhere else. |
| `web/plugin_imports`                     | `load_plugin_modules`: imports the entries `register_plugin_files` lists, each one bundled file whose imports of modules the page hands over with `share_modules`, such as React, are pointed at the page's own copies, found with es-module-lexer. |
| `web/react/plugins`                      | `PluginSlot` draws what running plugins put in a slot, each part behind react-error-boundary so one that throws is left out alone; `use_plugin_shortcuts` and `plugin_menu_items` for their commands; `PluginSettings`, a settings group per plugin with its on switch, state and why it waits or failed, and its fields as controls; `use_plugins`. |
| `electron/bridge`                        | `define_bridge`: one method table for the preload, the main process, and a web page's calls to its server; `handle` takes a `trusted` guard on the sender frame and answers in `envelopes`, which the client unwraps into Errors with the message alone, and a plain client strips Electron's remote-method prefix; `to_envelope`; `with_cloneable_arguments` flattens what structured clone refuses, such as a Proxy. |
| `electron/events`                        | `define_events`: messages the main process pushes to its pages, such as progress, on one channel and subscribed to by name. |
| `electron/app`                           | `hold_single_instance`, `bring_to_front`, and `first_argument` for a link handed over on the command line. |
| `electron/window`                        | `create_window`: links and other sites open in the browser, the background follows the system theme, and the size and place are remembered, through the app's write guard if it has one; timers can keep running while hidden. |
| `electron/fetch`                         | `create_main_fetch` and `create_page_fetch`: the page's requests sent from the main process past cross-origin rules, to an allow-list of hosts, with headers such as `Origin` pinned; `create_main_stream_fetch` and `create_page_stream_fetch` carry the body chunk by chunk over an events channel into a `ReadableStream` body, for a player that reads as it lands, cancelled by the request's signal. |
| `agent/commands`                         | `run_command` and `stream_command`: one shell command, in its own process group. |
| `agent/programs`                         | `run_program`: one program with its arguments and no shell, each stream shown to a sink, kept, both or dropped, stopped by an abort signal and, in a process group of its own, with all it started; 127 when it is not installed; `BoundedBuffer`, `signal_group` and `on_path`. |
| `agent/long_runs`                        | `LongRuns`: commands that outlive the agent, their output and exit code kept on disk. |
| `agent/keys`                             | Reads and makes OpenSSH ed25519 agent keys; signs and checks the login challenge. |
| `agent/protocol`                         | The messages between the server and an agent.                                 |
| `agent/session`, `agent/client`          | The agent's side: `start_agent` dials the server and answers it.              |
| `agent/tasks`                            | `TaskRunner`, and `shell_runner` for apps whose tasks are command lines.      |
| `server/agents/hub`                      | `AgentHub`: the agents that have dialled in, and the server's built-in one.   |
| `server/agents/connection`, `agent`, `local`, `route` | One connected agent, the `Agent` interface, `LocalAgent`, and the Fastify route. |
| `server/passwords`                       | scrypt hashes and the `name:hash` accounts file.                              |
| `server/hash_password`                   | The `hash-password` command.                                                  |
| `server/backup_files`                    | `file_backup_store`: the `backups` store as files in a folder on disk.        |
| `server/sign_in`, `server/login_page`    | `register_token_sign_in`: a server with one secret signs browsers in on its own login page, keeps them in by an HMAC-derived cookie, takes the secret as a bearer header, waits after a wrong try, and turns the rest away (401 in text or JSON under the API prefix, 303 to the login page elsewhere, with open paths); `register_sign_in_guard` is the turning-away alone, for an app with its own sessions. |
| `server/password_sign_in`                | `register_password_sign_in`: names and passwords from the accounts file open a session the server keeps (on @fastify/session) through `/api/login`, with `/api/logout` and `/api/me`; a wrong name takes as long as a wrong password, an address gets a few tries before it waits (on @fastify/rate-limit), and other API paths but the open ones answer 401 as JSON. |
| `server/events`                          | `EventStream`: server-sent events with a client id per page, a heartbeat, `announce_change(except_client_id)` so the page that made a change is not told, nameless or named events to all or chosen clients, and every stream ended with the app. |
| `server/web_folder`                      | `register_web_folder`: the built page from a folder, tuned for the Nix store (no etag or date, hashed `/assets/` kept a year, the page fetched fresh), a warning, error or nothing when the folder is missing, and the page for unknown paths when it routes itself. |
| `server/replies`                         | `register_error_replies`: errors and unknown paths answered in plain text or as `{ error }`; `register_lenient_json_body`: an empty body as no arguments and bad JSON as `BAD_JSON`, for the route to refuse in its own words; `send_text`. |
| `server/config`                          | `read_server_config`: host, port, web folder and the app's options from flags, then the environment, then defaults, with usage text for `--help`, the secret from `<PREFIX>_TOKEN_FILE` or `<PREFIX>_TOKEN`, and no listening beyond this machine without one; `read_secret_file`. |
| `server/cors`                            | `register_open_cors`: any origin may call the API, as a native or mobile shell does from a page of its own, with the client id header allowed. |
| `web/dom`, `web/format`, `web/router`, `web/theme` | The page's element builder and `cx` class joiner, formatters (including `compact_count`, such as `"1.4M"`), hash router and theme choice, kept in this browser or the app's settings, and `follow_host_theme` for taking a host page's colours, such as the Linux sidebar's. |
| `web/markdown_text`                      | `as_code_block` and `code_fence`: text as a fenced code block whose fence outruns any backticks inside it, with no page needed, such as for a database upgrade. |
| `web/states`, `web/tables`, `web/menus`, `web/split`, `web/errors` | `LoginNeeded`; sorting by several columns, trees and column order; menu items, placement and keys; pane sizing; `describe_error` for anything thrown, such as shaka's coded objects. |
| `web/api`, `web/events`                  | `create_api`: JSON calls whose 401 throws `LoginNeeded` except on open paths such as the login, whose refusals throw `ApiError` in the server's words, with headers read afresh per call; `follow_changes`: the page's side of `EventStream`, a watch bumped on each change and after a reconnect, and the client id to send back. |
| `web/tree`                               | Rows with `parent_id` and `position`: nesting, subtrees, tree order, paths, and where a dropped or keyed row lands, its siblings ordered by position or, with `by_list_order`, as the list gives them. |
| `web/watch`, `web/react/watch`           | `create_watch`: a change counter a store bumps; `use_watch` redraws only the components that read that store; `coalesce_bumps` lands a bump at most once per interval, for streamed tokens. |
| `web/store`, `web/react/store`           | `create_store`: a value with a watch, set or updated, redrawing at a steady pace when `coalesce_in_milliseconds` is given; `use_store` reads it. |
| `web/prefs`, `web/react/prefs`           | Remembered view settings that read as their default when stored corrupt, stale or of the wrong shape; `use_pref` keeps one as component state. |
| `web/selection`, `web/virtual`, `web/drag` | Picking rows with plain, Ctrl and Shift clicks from a fixed anchor, or as lists of ids with the anchor kept by id, the row an arrow or page key moves to; which rows of a long list a viewport needs; a badge such as "3 tasks" as the drag image. |
| `web/react/shell`                        | `Shell`: top bar with the brand and its icon, section links or the app's own sidebar in a `.sidebar-content` box, resizable, theme button, a `status_bar` at the foot, toasts, dialogs and menus, with or without logins (no account UI without a `user`, `logged_out` hiding the sidebar and tools), its phone menu held by the Shell or the app, and for app-like pages a `contained` window where only main scrolls, the brand heading the sidebar, and a `sidebar_foot` held at the sidebar's bottom; `use_route`. |
| `web/react/layout`, `badges`, `states`   | `PageHeading` with a subtitle, icon, banner, actions and a `level` for inside dialogs and panels; panels, facts, tiles, cards, tabs, crumbs, steppers, `FormRow` for a form's labelled fields, `SettingsPage` with an outline beside its sections that marks the one being read, settings rows, `RowActions` and `moved` for ordered lists, `SelectionBar` for picked rows; badges, chips in an item's own colour, dashed or removable, `ColorDot` and `StatusPill`, a state dot with text and an action; `use_resource` with its `status` (idle until `enabled`, loading, loaded, failed), a `watch` that reloads it quietly, and its loading states, `Loaded` going by the status so a null result shows its `empty` slot or the children. |
| `web/react/time`                         | `Age`: a time as how long ago, with the full stamp on hover; `use_now`, the time read again each minute. |
| `web/react/login`                        | `LoginForm`, the name and password form; `use_session`, the page's session checked once at start and lost whenever a `LoginNeeded` goes unhandled; they pair with `server/password_sign_in`. |
| `web/react/reveal`                       | `use_reveal`: a long list shown a page at a time, the next page added as its end scrolls into view, starting from the count shown before the page was left if given. |
| `web/react/media`                        | `Avatar`, a round picture or the name's first letter; `MediaTile` and `MediaGrid`: videos, albums or playlists as tiles in a grid or as rows, with text over the picture's corner such as a length, lines under the title, a faded look, and buttons in the corner. |
| `web/react/menu_button`                  | `MenuButton`: a ⋮ button that opens a menu under itself, even inside a link, saying through `aria-expanded` whether it is open. |
| `web/react/test_stubs`                   | Stands in for `showPopover`, `hidePopover`, `showModal`, `close`, `matchMedia`, `scrollTo`, `ResizeObserver` and text's `getClientRects`, which jsdom lacks; an app's widget tests import it for its side effects, and a node test's shared setup may import it too. |
| `web/react/list_picker`                  | `pick_list_dialog`: adds one thing to any of the app's lists, such as a video to playlists, ticking the lists that hold it and making a new one. |
| `web/react/emoji_picker`                 | `EmojiPicker` on Frimousse, searchable, grouped and worked by keyboard, its Emojibase list bundled in a chunk of its own so it works offline; `EmojiField`, a button showing the chosen emoji that opens the picker under itself, with a clear button. |
| `web/react/controls`, `table`            | Segmented choices, button groups, switches, search boxes that hand on typing as it pauses, submit on Enter or a button, clear on Escape, can take a paste whole, take focus and follow a value cleared from outside, selects, `CommitInput`, `DateTimeField`, `PathInput` with a Browse button on the app's picker, `ColorPicker`, `TreeSelect` opening an indented card that shows the picked path, `TreePicker` searching a tree as it is typed into, matches shown under their parents; `DataTable` on TanStack Table, sorting by several columns, with columns to move, resize, hide and filter from buttons pinned over the heading band, a `header` such as an icon shown in place of a column's label, tree rows, groups under headings, rows the app drags and styles, rows that come sorted from a database, rows worked by keyboard, rows that draw again only when they change, `virtual` rows drawn only where they show, a last column that fills the room left, group headings that hide when the filter empties them, a `wrap_class` for Halon's `scroll` and `sticky-head`, and cards on phones; a pager. |
| `web/react/shortcuts`                    | `use_shortcuts` for keys such as `"mod+z"`, quiet while typing or while a dialog or popover is open; `describe_keys` for help text. |
| `web/react/tree`                         | `Tree`: nested rows that fold, walk with the arrow keys, reorder by dragging or with Alt and the arrow keys, show several picked, and take drops from outside. |
| `web/react/toasts`, `dialog`, `menus`, `split` | Toasts with a link or Undo that say how they closed, and `undoable` actions that commit or undo exactly once; modal dialogs with a subtitle, header actions, a full-window size and a `form` whose submit button sends it, and confirm and text dialogs, openable from anywhere; context menus and popovers worked by keyboard, openable from anywhere, their keep-open items ticking at once; resize handles and splits. |
| `web/react/page_view`                    | `PageView`: a full-window page over the app on the Dialog, such as Settings or an item's properties, with a Close button, actions beside it and section tabs that stay put while the body scrolls. |
| `web/react/progress`                     | `ProgressBar`: a bar with its value out of a max, busy while the amount of work is unknown, and words or the percentage beside it. |
| `web/react/rating`                       | `Rating`: stars that show a rating or take one by click or keyboard, with unrated kept apart from none. |
| `web/react/volume`                       | `VolumeButton`: a speaker button that opens a slider; scrolling over it adjusts the volume and a middle-click mutes. |
| `web/react/following`                    | `use_follow_tail`, `FollowingOutput` and `FollowToggle`: output that keeps its newest lines in view as they arrive unless the reader scrolled up, with a Follow switch. |
| `web/react/markdown`                     | `Markdown` and `render_markdown` on marked and DOMPurify, chosen because marked covers the hand-written parser feature for feature and adds tables and nested lists: raw HTML shows as text, only web links are clickable and open in a new tab, and `follow` keeps streamed text in view. |
| `web/react/rich_text`                    | `RichText`: a formatted text field on Tiptap that reads and writes Markdown, chosen because Tiptap ships no look of its own, so its toolbar is Halon markup, and its Markdown extension keeps the stored text plain: bold, italic, strikethrough, code, headings, lists, checklists, quotes, code blocks and web links, `on_change` only for typing, never for showing a value. |
| `web/react/suggestions`                  | `Suggestions`: completions under any text field from a sync or async source; arrow keys choose, Tab or Enter take, Escape dismisses, other keys pass through. |

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

An app with its own sessions, such as one logging in by name and password, uses `register_sign_in_guard` with its
own `is_signed_in`, `login_path: null` so its page loads and logs in itself, and `refusal: "json"`.

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
content in a popover X-Libs opens from the column's funnel. A request whose session has lapsed
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

`create_window` keeps the app's own pages in the window: a link or a navigation to another site opens in the browser,
and only web and mail links leave the app.

## The app and its tasks

The server and every agent are given the same `AgentApp`: the app's name, its protocol version, and its tasks.

- The **name**, such as `x-nix`, names the key login's header (`x-nix-agent-host`) and is bound into the challenge the
  agent signs (`x-nix-agent-v1|<host>|<nonce>`), so agents already deployed for an app keep logging in.
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

## Development

```sh
nix-shell        # Node 24 and ssh-keygen, which the key tests use
npm install
npm run build    # compiles src/ into dist/
npm test
npm run lint
```

`npm pack` and `npm publish` build first.

## License

GPL-3.0-or-later.
