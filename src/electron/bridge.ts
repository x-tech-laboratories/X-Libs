// One table of method names serves the Electron preload, the main process and a web page's calls to its server alike.

// ── Electron's shapes ────────────────────────────────────────────────────────

// Only the parts of Electron the bridge uses, so this module builds without Electron installed.
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

// The event a main-process handler gets, with the frame the call came from.
export interface IpcMainEventLike {
  senderFrame?: { url: string } | null;
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
  [Name in keyof Methods]: (...args: Parameters<Methods[Name]>) => Awaited<ReturnType<Methods[Name]>> | Promise<Awaited<ReturnType<Methods[Name]>>>;
};

// Sends one call to wherever the methods are answered, such as a POST to the server, and gives back its answer.
export type CallRemote = (method: string, args: unknown[]) => Promise<unknown>;

// A reply that carries its result or the failure's words, so an error crosses IPC as a plain message.
export type Envelope<Result = unknown> = { ok: true; result: Result } | { ok: false; error: string };

export interface HandleOptions {
  // Refuses a call from any page but the app's own, such as electron/window's is_app_page on the sender frame's URL.
  trusted?: (event: IpcMainEventLike) => boolean;
  // Answers in envelopes, so the page's client unwraps a failure into an Error with the message alone.
  envelopes?: boolean;
}

export interface ClientOptions {
  // Unwraps envelope replies from a handler that answers in them.
  envelopes?: boolean;
}

export interface Bridge<Methods extends Record<keyof Methods, AnyMethod>> {
  api_name: string;
  method_names: readonly (keyof Methods & string)[];
  // The IPC channel a method travels on, such as "x_tasks:list_tasks".
  channel: (method: keyof Methods & string) => string;
  // In the preload: puts the client on the page's window under api_name.
  expose: (context_bridge: ContextBridgeLike, ipc_renderer: IpcRendererLike, options?: ClientOptions) => void;
  // The client the preload would expose, for a preload that adds its own extras before exposing it; a failure reaches the page with a clean message.
  ipc_client: (ipc_renderer: IpcRendererLike, options?: ClientOptions) => Client<Methods>;
  // In the main process: answers every method, and gives back a function that stops answering.
  handle: (ipc_main: IpcMainLike, implementation: Implementation<Methods>, options?: HandleOptions) => () => void;
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

  const ipc_client = (ipc_renderer: IpcRendererLike, options: ClientOptions = {}): Client<Methods> => {
    const invoke = options.envelopes ? unwrapping_invoker(ipc_renderer) : clean_invoker(ipc_renderer);
    return client_through((method, args) => invoke.invoke(channel(method), ...args));
  };

  return {
    api_name,
    method_names,
    channel,
    dispatch,
    ipc_client,
    expose: (context_bridge, ipc_renderer, options) => {
      context_bridge.exposeInMainWorld(api_name, ipc_client(ipc_renderer, options));
    },
    handle: (ipc_main, implementation, options = {}) => {
      for (const method of method_names) {
        ipc_main.handle(channel(method), (event, ...args) => {
          const answer = () => {
            if (options.trusted && !options.trusted((event ?? {}) as IpcMainEventLike)) throw new Error("Untrusted sender.");
            return dispatch(implementation, method, args);
          };
          return options.envelopes ? to_envelope(answer) : answer();
        });
      }
      return () => { for (const method of method_names) ipc_main.removeHandler(channel(method)); };
    },
    web_rpc: client_through,
  };
}

// ── Envelopes and errors ─────────────────────────────────────────────────────

// Runs the work and puts its result or its failure's words in an envelope.
export async function to_envelope<Result>(work: () => Result | Promise<Result>): Promise<Envelope<Awaited<Result>>> {
  try {
    return { ok: true, result: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

// Electron reports a rejected handler as "Error invoking remote method 'x': Error: words", which the page shows as the words alone.
export function clean_error_message(message: string): string {
  return message.replace(REMOTE_ERROR_PREFIX, "");
}

// An ipcRenderer whose rejections carry clean messages.
export function clean_invoker(ipc_renderer: IpcRendererLike): IpcRendererLike {
  return {
    invoke: async (channel, ...args) => {
      try {
        return await ipc_renderer.invoke(channel, ...args);
      } catch (error) {
        if (error instanceof Error) throw new Error(clean_error_message(error.message));
        throw error;
      }
    },
  };
}

// An ipcRenderer that opens envelope replies, throwing a failure as an Error with its message.
export function unwrapping_invoker(ipc_renderer: IpcRendererLike): IpcRendererLike {
  return {
    invoke: async (channel, ...args) => {
      const envelope = (await ipc_renderer.invoke(channel, ...args)) as Envelope;
      if (!envelope.ok) throw new Error(envelope.error);
      return envelope.result;
    },
  };
}
// ── Cloning ──────────────────────────────────────────────────────────────────

// A value that survives structured clone passes as it is, and anything else, such as a Proxy, crosses as plain JSON.
export function to_cloneable(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    structuredClone(value);
    return value;
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

// The same client with every argument made cloneable first, since Electron clones arguments before the preload sees them.
export function with_cloneable_arguments<Methods extends Record<keyof Methods, AnyMethod>>(client: Client<Methods>): Client<Methods> {
  const wrapped: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(client) as [string, (...args: unknown[]) => unknown][]) {
    wrapped[name] = (...args: unknown[]) => method(...args.map(to_cloneable));
  }
  return wrapped as Client<Methods>;
}
