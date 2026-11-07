# X-Libs

Code the X-apps share, published as one npm package, `@x-tech-laboratories/x-libs`, with a subpath per module.

## Modules

| Import                                   | What it holds                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `durations`                              | `parse_duration` for settings such as `"2h30m"`, `format_duration`, `format_age`. |
| `dates`                                  | Local dates as `"2026-06-10"` or `"2026-06-10T09:30"`: reading, writing, adding days and months, overdue, and Yesterday/Today/Tomorrow labels. |
| `electron/bridge`                        | `define_bridge`: one method table for the preload, the main process, and a web page's calls to its server. |
| `electron/window`                        | `create_window`: links open in the browser, the background follows the system theme, and the size and place are remembered. |
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
| `web/dom`, `web/format`, `web/router`, `web/theme` | The page's element builder, formatters, hash router and theme choice. |
| `web/states`, `web/tables`, `web/menus`, `web/split` | `LoginNeeded`; table sorting; menu items and on-screen placement; pane sizing. |
| `web/tree`                               | Rows with `parent_id` and `position`: nesting, subtrees, and where a dropped or keyed row lands. |
| `web/react/shell`                        | `Shell`: top bar, sidebar, theme button, toasts and dialogs; `use_route`.       |
| `web/react/layout`, `badges`, `states`   | Panels, facts, tiles, cards, tabs, crumbs, steppers, settings rows; badges and chips; `use_resource` and its loading states. |
| `web/react/time`                         | `Age`: a time as how long ago, with the full stamp on hover. |
| `web/react/controls`, `table`            | Segmented choices, button groups, switches, search boxes, selects; sortable tables that turn into cards on phones, and a pager. |
| `web/react/shortcuts`                    | `use_shortcuts` for keys such as `"mod+z"`, quiet while typing or while a dialog or popover is open; `describe_keys` for help text. |
| `web/react/tree`                         | `Tree`: nested rows that fold, walk with the arrow keys, and reorder by dragging or with Alt and the arrow keys. |
| `web/react/toasts`, `dialog`, `menus`, `split` | Toasts with a link or Undo; modal, confirm and text dialogs openable from anywhere; context menus and popovers; resize handles and splits. |

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
holds the toasts and dialogs that `toast` and `confirm_dialog` open from anywhere. A request whose session has lapsed
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
