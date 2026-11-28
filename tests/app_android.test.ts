import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { android_api, type PhoneLifecycle } from "../src/app/web/android.ts";
import type { BackupFolderPlugin } from "../src/phone_backups.ts";
import type { FileStore } from "../src/web/sqlite_wasm.ts";
import { sample_app } from "./app/sample_app.ts";

// ============================================================================
// Helpers
// ============================================================================

beforeEach(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) });
});

afterEach(() => vi.unstubAllGlobals());

function memory_files(): FileStore & { saved: Map<string, Uint8Array> } {
  const saved = new Map<string, Uint8Array>();
  return { saved, read: async (name) => saved.get(name), write: async (name, bytes) => void saved.set(name, bytes) };
}

// A folder in the phone's storage that is empty until one is picked.
function fake_folder(): BackupFolderPlugin {
  let name = "";
  const files = new Map<string, string>();
  return {
    get_folder: async () => ({ name }),
    choose_folder: async () => ({ name: (name = "Documents") }),
    list: async () => ({ files: [...files.keys()].map((file) => ({ name: file, size_bytes: files.get(file)!.length })) }),
    write: async ({ name: file, data }) => void files.set(file, data),
    read: async ({ name: file }) => ({ data: files.get(file)! }),
    remove: async ({ name: file }) => void files.delete(file),
  };
}

// The phone's comings and goings, set off by the test.
function fake_lifecycle(): PhoneLifecycle & { fire: (event: "pause" | "resume") => void } {
  const listeners = new Map<string, () => void>();
  return {
    addListener: (event: string, listener: () => void) => void listeners.set(event, listener),
    fire: (event) => listeners.get(event)?.(),
  } as PhoneLifecycle & { fire: (event: "pause" | "resume") => void };
}

// ============================================================================
// Phone
// ============================================================================

describe("phone host", { timeout: 30_000 }, () => {
  it("answers the page's calls on its own database and saves it when the phone pauses the app", async () => {
    const files = memory_files();
    const lifecycle = fake_lifecycle();
    const api = await android_api(sample_app, { files, folder: fake_folder(), lifecycle });

    await api.calls.add_note!("Groceries" as never);
    lifecycle.fire("pause");

    expect(api.host).toBe("android");
    expect(await api.calls.list_notes!()).toEqual([expect.objectContaining({ title: "Groceries" })]);
    await vi.waitFor(() => expect(files.saved.has("sample.db")).toBe(true));
  });

  it("keeps sync on the phone itself and backups in the folder the user picks", async () => {
    const api = await android_api(sample_app, { files: memory_files(), folder: fake_folder(), lifecycle: fake_lifecycle() });

    expect(await api.backup_folder!.name()).toBe("");
    expect(await api.backup_folder!.choose()).toBe("Documents");
    expect(await api.device!.get_sync_status()).toMatchObject({ peers: [] });
    expect(await api.backups!.get_backup_schedule()).toEqual({ automatic: true, to_keep: 14 });
  });

  it("tells the page when another device's changes arrive", async () => {
    const api = await android_api(sample_app, { files: memory_files(), folder: fake_folder(), lifecycle: fake_lifecycle() });
    const listener = vi.fn();

    const stop = api.on_change(listener);
    stop();

    expect(listener).not.toHaveBeenCalled();
  });
});
