# X-Libs

Code the X-apps share, published as one npm package, `@x-tech-laboratories/x-libs`, with a subpath per module.

## Modules

| Import                                   | What it holds                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `durations`                              | `parse_duration` for settings such as `"2h30m"`, `format_duration`, `format_age`. |
| `agent/commands`                         | `run_command` and `stream_command`: one shell command, in its own process group. |
| `agent/long_runs`                        | `LongRuns`: commands that outlive the agent, their output and exit code kept on disk. |
| `agent/keys`                             | Reads and makes OpenSSH ed25519 agent keys; signs and checks the login challenge. |
| `agent/protocol`                         | The messages between the server and an agent.                                 |
| `agent/session`, `agent/client`          | The agent's side: `start_agent` dials the server and answers it.              |
| `server/agents/hub`                      | `AgentHub`: the agents that have dialled in, and the server's built-in one.   |
| `server/agents/connection`, `agent`, `local`, `route` | One connected agent, the `Agent` interface, `LocalAgent`, and the Fastify route. |
| `server/passwords`                       | scrypt hashes and the `name:hash` accounts file.                              |
| `server/hash_password`                   | The `hash-password` command.                                                  |
| `web/dom`, `web/format`, `web/router`, `web/theme` | The page's element builder, formatters, hash router and theme choice. |
| `web/layout`, `web/badges`, `web/states` | Panels, facts, tiles, cards, tabs, crumbs, toolbars, steppers; badges and chips; loading, empty and failed states. |
| `web/controls`, `web/tables`             | Search boxes, selects, segmented choices, switches, button groups; sortable tables that turn into cards on phones, and a pager. |
| `web/toasts`, `web/dialogs`, `web/menus` | Toasts with a link or Undo, modal and confirm dialogs, right-click menus and popovers kept on screen. |
| `web/split`, `web/shell`                 | Pane sizing and resize handles; the sidebar menu, the section it lights up, and the theme button. |
| `web/preact/*`                           | The same widgets as Preact components: menus, split, controls, layout, dialog, table. |

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
import { data_table } from "@x-tech-laboratories/x-libs/web/tables";
import { ContextMenu } from "@x-tech-laboratories/x-libs/web/preact/menus";
```

A request whose session has lapsed throws `LoginNeeded` from `web/states`; `load` and `attempt` pass it on so the page can ask for a login.

## The app's name

The agent modules take the app's name, such as `x-nix`. It names the key login's header (`x-nix-agent-host`), is bound
into the challenge the agent signs (`x-nix-agent-v1|<host>|<nonce>`), and names a long run's process (`x-nix-run`), so
agents already deployed for an app keep logging in.

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

`npm publish` builds first.

## License

GPL-3.0-or-later.
