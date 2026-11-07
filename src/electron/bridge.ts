// One table of method names serves the Electron preload, the main process and a web page's calls to its server alike.

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron the bridge uses, so this module builds without Electron installed.
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export interface ContextBridgeLike {
  exposeInMainWorld(api_key: string, api: unknown): void;
}

// ── Method tables ────────────────────────────────────────────────────────────

type AnyMethod = (...args: never[]) => unknown;

// The methods as the page calls them: the same arguments, always answered later.
export type Client<Methods extends Record<keyof Methods, AnyMethod>> = {
  [Name in keyof Methods]: (...args: Parameters<Methods[Name]>) => Promise<Awaited<ReturnType<Methods[Name]>>>;
};

// The methods as the main process or a server answers them, at once or later.
export type Implementation<Methods extends Record<keyof Methods, AnyMethod>> = {
  [Name in keyof Methods]: (...args: Parameters<Methods[Name]>) => ReturnType<Methods[Name]> | Promise<Awaited<ReturnType<Methods[Name]>>>;
};

// Sends one call to wherever the methods are answered, such as a POST to the server, and gives back its answer.
export type CallRemote = (method: string, args: unknown[]) => Promise<unknown>;

export interface Bridge<Methods extends Record<keyof Methods, AnyMethod>> {
  api_name: string;
  method_names: readonly (keyof Methods & string)[];
  // The IPC channel a method travels on, such as "x_tasks:list_tasks".
  channel: (method: keyof Methods & string) => string;
  // In the preload: puts the client on the page's window under api_name.
  expose: (context_bridge: ContextBridgeLike, ipc_renderer: IpcRendererLike) => void;
  // The client the preload would expose, for a preload that adds its own extras before exposing it.
  ipc_client: (ipc_renderer: IpcRendererLike) => Client<Methods>;
  // In the main process: answers every method, and gives back a function that stops answering.
  handle: (ipc_main: IpcMainLike, implementation: Implementation<Methods>) => () => void;
  // In a web page: the same client, each call sent through call_remote.
  web_rpc: (call_remote: CallRemote) => Client<Methods>;
  // On a server: answers one call by name, refusing names outside the table.
  dispatch: (implementation: Implementation<Methods>, method: string, args: unknown[]) => Promise<unknown>;
}

export function define_bridge<Methods extends Record<keyof Methods, AnyMethod>>(
  api_name: string,
  method_names: readonly (keyof Methods & string)[],
): Bridge<Methods> {
  const channel = (method: string) => `${api_name}:${method}`;
  const is_method = (method: string): method is keyof Methods & string => (method_names as readonly string[]).includes(method);

  function client_through(call: CallRemote): Client<Methods> {
    return Object.fromEntries(method_names.map((method) => [method, (...args: unknown[]) => call(method, args)])) as unknown as Client<Methods>;
  }

  async function dispatch(implementation: Implementation<Methods>, method: string, args: unknown[]): Promise<unknown> {
    if (!is_method(method)) throw new Error(`${api_name} has no method ${method}`);
    const answer = implementation[method] as (...args: unknown[]) => unknown;
    return answer.apply(implementation, args);
  }

  return {
    api_name,
    method_names,
    channel,
    dispatch,
    ipc_client: (ipc_renderer) => client_through((method, args) => ipc_renderer.invoke(channel(method), ...args)),
    expose: (context_bridge, ipc_renderer) => {
      context_bridge.exposeInMainWorld(api_name, client_through((method, args) => ipc_renderer.invoke(channel(method), ...args)));
    },
    handle: (ipc_main, implementation) => {
      for (const method of method_names) {
        ipc_main.handle(channel(method), (_event, ...args) => dispatch(implementation, method, args));
      }
      return () => { for (const method of method_names) ipc_main.removeHandler(channel(method)); };
    },
    web_rpc: client_through,
  };
}
