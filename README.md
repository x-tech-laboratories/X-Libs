# X-Libs

Code the X-apps share, published as one npm package, `@x-tech-laboratories/x-libs`, with a subpath per module.

## Modules

| Import                                   | What it holds                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `durations`                              | `parse_duration` for settings such as `"2h30m"`, `format_duration` in months down to seconds, `format_age`, and `format_clock` for a playing time such as `"3:07"`. |
| `log`                                    | Loggers by scope and level from a setting such as `"warn,play:debug"`; a malformed setting falls back instead of silencing logging, and a setting read through a function applies to loggers made before it arrived. |
| `dates`                                  | Local dates as `"2026-06-10"` or `"2026-06-10T09:30"`: reading, writing, adding days and months, overdue, and Yesterday/Today/Tomorrow labels. |
| `backups`                                | Named backups of an app's data in any store, newest first, with daily automatic ones kept to a set number. |
| `electron/bridge`                        | `define_bridge`: one method table for the preload, the main process, and a web page's calls to its server; `with_cloneable_arguments` flattens what structured clone refuses, such as a Proxy. |
| `electron/events`                        | `define_events`: messages the main process pushes to its pages, such as progress, on one channel and subscribed to by name. |
| `electron/app`                           | `hold_single_instance`, `bring_to_front`, and `first_argument` for a link handed over on the command line. |
| `electron/window`                        | `create_window`: links and other sites open in the browser, the background follows the system theme, and the size and place are remembered, through the app's write guard if it has one; timers can keep running while hidden. |
| `electron/fetch`                         | `create_main_fetch` and `create_page_fetch`: the page's requests sent from the main process past cross-origin rules, to an allow-list of hosts, with headers such as `Origin` pinned. |
| `agent/commands`                         | `run_command` and `stream_command`: one shell command, in its own process group. |
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
| `web/dom`, `web/format`, `web/router`, `web/theme` | The page's element builder, formatters (including `compact_count`, such as `"1.4M"`), hash router and theme choice, kept in this browser or the app's settings. |
| `web/states`, `web/tables`, `web/menus`, `web/split` | `LoginNeeded`; sorting by several columns, trees and column order; menu items, placement and keys; pane sizing. |
| `web/tree`                               | Rows with `parent_id` and `position`: nesting, subtrees, tree order, paths, and where a dropped or keyed row lands. |
| `web/watch`, `web/react/watch`           | `create_watch`: a change counter a store bumps; `use_watch` redraws only the components that read that store. |
| `web/prefs`, `web/react/prefs`           | Remembered view settings that read as their default when stored corrupt, stale or of the wrong shape; `use_pref` keeps one as component state. |
| `web/selection`, `web/virtual`, `web/drag` | Picking rows with plain, Ctrl and Shift clicks from a fixed anchor, or as lists of ids with the anchor kept by id, the row an arrow or page key moves to; which rows of a long list a viewport needs; a badge such as "3 tasks" as the drag image. |
| `web/react/shell`                        | `Shell`: top bar, section links or the app's own sidebar, resizable, theme button, toasts, dialogs and menus, with or without logins, its phone menu held by the Shell or the app; `use_route`. |
| `web/react/layout`, `badges`, `states`   | Panels, facts, tiles, cards, tabs, crumbs, steppers, settings rows, `RowActions` and `moved` for ordered lists, `SelectionBar` for picked rows; badges and chips; `use_resource` and its loading states. |
| `web/react/time`                         | `Age`: a time as how long ago, with the full stamp on hover; `use_now`, the time read again each minute. |
| `web/react/reveal`                       | `use_reveal`: a long list shown a page at a time, the next page added as its end scrolls into view. |
| `web/react/controls`, `table`            | Segmented choices, button groups, switches, search boxes that can take focus and follow a value cleared from outside, selects, `CommitInput`, `DateTimeField`, `ColorPicker`, `TreeSelect`; `DataTable` on TanStack Table, sorting by several columns, with columns to move, resize, hide and filter, tree rows, groups under headings, rows the app drags and styles, rows that come sorted from a database, rows worked by keyboard, and cards on phones; a pager. |
| `web/react/shortcuts`                    | `use_shortcuts` for keys such as `"mod+z"`, quiet while typing or while a dialog or popover is open; `describe_keys` for help text. |
| `web/react/tree`                         | `Tree`: nested rows that fold, walk with the arrow keys, reorder by dragging or with Alt and the arrow keys, show several picked, and take drops from outside. |
| `web/react/toasts`, `dialog`, `menus`, `split` | Toasts with a link or Undo that say how they closed, and `undoable` actions that commit or undo exactly once; modal, confirm and text dialogs openable from anywhere; context menus and popovers worked by keyboard, openable from anywhere; resize handles and splits. |

```ts
import { AgentHub } from "@x-tech-laboratories/x-libs/server/agents/hub";
import { parse_duration } from "@x-tech-laboratories/x-libs/durations";
```

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
