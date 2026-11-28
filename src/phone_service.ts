// Work a phone app keeps doing while it is closed, such as staying reachable by the user's computers, run in an
// Android foreground service by X-App's XLibsForegroundService plugin. The work is the worker, a page of the app's own
// that the service loads in a WebView of its own, so it outlives the app's window; the page and the worker talk in
// messages, each carried across as JSON.
//
// The app declares the service in its AndroidManifest.xml, so no other app gets the permissions:
//   <service android:name="com.xtechlaboratories.xlibs.PhoneService" android:exported="false"
//     android:foregroundServiceType="connectedDevice" />
//   <receiver android:name="com.xtechlaboratories.xlibs.PhoneServiceBoot" android:exported="false"> with an
//     intent-filter for android.intent.action.BOOT_COMPLETED and android.intent.action.MY_PACKAGE_REPLACED
//   and the permissions FOREGROUND_SERVICE, FOREGROUND_SERVICE_CONNECTED_DEVICE, CHANGE_NETWORK_STATE,
//   POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED.

// ── Imports ──────────────────────────────────────────────────────────────────

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// ── Plugin ───────────────────────────────────────────────────────────────────

export interface ForegroundServicePlugin {
  // Starts the service, or updates its notification and settings when it runs; `worker` is a page path under the app's page files.
  start: (options: { title: string; text: string; worker: string; start_at_boot: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  get_state: () => Promise<{ running: boolean; start_at_boot: boolean }>;
  // Fails while the service is stopped.
  post: (options: { message: string }) => Promise<void>;
  addListener: (event: "message", listener: (event: { message: string }) => void) => Promise<PluginListenerHandle>;
}

export const foreground_service_plugin = registerPlugin<ForegroundServicePlugin>("XLibsForegroundService");

// ── Page side ────────────────────────────────────────────────────────────────

export interface PhoneServiceOptions {
  // The notification Android shows while the service runs.
  title: string;
  text: string;
  // The worker page, such as "worker.html".
  worker: string;
  // Starts the service again when the phone boots, if it was running.
  start_at_boot?: boolean;
  // The service's side; the Android plugin unless set, such as in a test.
  plugin?: ForegroundServicePlugin;
}

export interface PhoneService<Message> {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  is_running: () => Promise<boolean>;
  post: (message: Message) => Promise<void>;
  // Gives the worker's messages to `listener` until the returned function is called.
  on_message: (listener: (message: Message) => void) => () => void;
}

export function phone_service<Message = unknown>({ title, text, worker, start_at_boot = false, plugin = foreground_service_plugin }: PhoneServiceOptions): PhoneService<Message> {
  const listeners = new Set<(message: Message) => void>();
  let handle: Promise<PluginListenerHandle> | null = null;

  const listen = () => {
    handle ??= plugin.addListener("message", ({ message }) => {
      const value = parse<Message>(message);
      if (value === undefined) return;
      for (const listener of listeners) listener(value);
    });
  };

  return {
    start: () => plugin.start({ title, text, worker, start_at_boot }),
    stop: () => plugin.stop(),
    is_running: async () => (await plugin.get_state()).running,
    post: (message) => plugin.post({ message: JSON.stringify(message) }),
    on_message(listener) {
      listeners.add(listener);
      listen();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !handle) return;
        const done = handle;
        handle = null;
        void done.then((entry) => entry.remove());
      };
    },
  };
}

// ── Worker side ──────────────────────────────────────────────────────────────

// What the service puts on the worker's window.
export interface WorkerWindow {
  XLibsWorkerHost?: { post: (message: string) => void };
  x_libs_worker_receive?: (message: string) => void;
}

export interface WorkerHost<Message> {
  // Whether this page runs as the service's worker.
  readonly present: boolean;
  post: (message: Message) => void;
  on_message: (listener: (message: Message) => void) => () => void;
}

// The worker's side of the messages, for code in the worker page.
export function worker_host<Message = unknown>(target: WorkerWindow = globalThis as WorkerWindow): WorkerHost<Message> {
  const listeners = new Set<(message: Message) => void>();
  target.x_libs_worker_receive = (message) => {
    const value = parse<Message>(message);
    if (value === undefined) return;
    for (const listener of listeners) listener(value);
  };
  return {
    present: target.XLibsWorkerHost !== undefined,
    post: (message) => target.XLibsWorkerHost?.post(JSON.stringify(message)),
    on_message(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

// ── Native modules ───────────────────────────────────────────────────────────

// Where the service hands the worker the events of X-App's native modules, such as phone_sockets'.
export interface NativeWindow {
  x_libs_native_event?: (module: string, json: string) => void;
  x_libs_native_modules?: Map<string, (json: string) => void>;
}

// Gives one native module's events to `handler`, replacing the module's handler before it.
export function on_native_event(module: string, handler: (json: string) => void, target: NativeWindow = globalThis as NativeWindow): void {
  const modules = (target.x_libs_native_modules ??= new Map());
  modules.set(module, handler);
  target.x_libs_native_event ??= (name, json) => target.x_libs_native_modules?.get(name)?.(json);
}

// ── Messages ─────────────────────────────────────────────────────────────────

// A message's value, or undefined for text that is not JSON.
function parse<Message>(text: string): Message | undefined {
  try {
    return JSON.parse(text) as Message;
  } catch {
    return undefined;
  }
}
