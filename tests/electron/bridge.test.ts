import { describe, expect, test, vi } from "vitest";

import {
  define_bridge, to_cloneable, with_cloneable_arguments, type ContextBridgeLike, type Implementation, type IpcMainLike, type IpcRendererLike,
} from "../../src/electron/bridge.ts";

interface NotesApi {
  list_notes: () => string[];
  add_note: (title: string, pinned: boolean) => { id: number; title: string };
}

const notes_bridge = define_bridge<NotesApi>("x_notes", ["list_notes", "add_note"]);

const implementation = {
  list_notes: () => ["first"],
  add_note: async (title: string, pinned: boolean) => ({ id: pinned ? 1 : 2, title }),
};

// Joins a fake ipcMain and ipcRenderer, as Electron does across the two processes.
function fake_ipc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc_main: IpcMainLike = {
    handle: (channel, listener) => { handlers.set(channel, listener); },
    removeHandler: (channel) => { handlers.delete(channel); },
  };
  const ipc_renderer: IpcRendererLike = {
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      return handler({ sender: "page" }, ...args);
    },
  };
  return { handlers, ipc_main, ipc_renderer };
}

describe("define_bridge", () => {
  test("names a channel per method", () => {
    expect(notes_bridge.channel("add_note")).toBe("x_notes:add_note");
  });

  test("the preload's client reaches the main process's methods", async () => {
    const { ipc_main, ipc_renderer } = fake_ipc();
    const exposed = new Map<string, unknown>();
    const context_bridge: ContextBridgeLike = { exposeInMainWorld: (key, api) => { exposed.set(key, api); } };
    notes_bridge.handle(ipc_main, implementation);

    notes_bridge.expose(context_bridge, ipc_renderer);
    const client = exposed.get("x_notes") as ReturnType<typeof notes_bridge.ipc_client>;

    expect(await client.list_notes()).toEqual(["first"]);
    expect(await client.add_note("Groceries", true)).toEqual({ id: 1, title: "Groceries" });
  });

  test("stops answering once its handlers are removed", async () => {
    const { handlers, ipc_main, ipc_renderer } = fake_ipc();
    const stop = notes_bridge.handle(ipc_main, implementation);

    stop();

    expect(handlers.size).toBe(0);
    await expect(notes_bridge.ipc_client(ipc_renderer).list_notes()).rejects.toThrow(/No handler/);
  });

  test("the web client and the server's dispatch share the method table", async () => {
    const call_remote = vi.fn((method: string, args: unknown[]) => notes_bridge.dispatch(implementation, method, JSON.parse(JSON.stringify(args))));
    const client = notes_bridge.web_rpc(call_remote);

    const note = await client.add_note("Call", false);

    expect(call_remote).toHaveBeenCalledWith("add_note", ["Call", false]);
    expect(note).toEqual({ id: 2, title: "Call" });
  });

  test("the server refuses a method outside the table", async () => {
    await expect(notes_bridge.dispatch(implementation, "toString", [])).rejects.toThrow("x_notes has no method toString");
  });
});

describe("cloneable arguments", () => {
  test("passes primitives and cloneable objects through as they are", () => {
    for (const value of [1, "x", true, null, undefined]) expect(to_cloneable(value)).toBe(value);
    const plain = { a: 1, b: [2, 3] };
    expect(to_cloneable(plain)).toBe(plain);
  });

  test("flattens a Proxy, alone or inside an object, which structured clone refuses", () => {
    const proxy = new Proxy([1, 2, 3], {});
    expect(() => structuredClone(proxy)).toThrow();

    expect(to_cloneable(proxy)).toEqual([1, 2, 3]);
    const flattened = to_cloneable({ ids: new Proxy([7, 8], {}), survivor: 7 });
    expect(() => structuredClone(flattened)).not.toThrow();
    expect(flattened).toEqual({ ids: [7, 8], survivor: 7 });
  });

  test("a wrapped client flattens every argument before the call", async () => {
    const add_note = vi.fn(async (title: string, pinned: boolean) => ({ id: pinned ? 1 : 2, title }));
    const client = with_cloneable_arguments<NotesApi>({ list_notes: async () => [], add_note });

    await client.add_note(new Proxy({ toJSON: () => "Groceries" }, {}) as unknown as string, true);

    expect(add_note).toHaveBeenCalledWith("Groceries", true);
  });
});

describe("implementation", () => {
  test("answers a method the page awaits with a plain value", async () => {
    interface PageApi { count_notes: () => Promise<number> }
    const page_bridge = define_bridge<PageApi>("x_notes", ["count_notes"]);
    const answers: Implementation<PageApi> = { count_notes: () => 3 };

    expect(await page_bridge.dispatch(answers, "count_notes", [])).toBe(3);
  });
});
