// Notices handed to a phone ahead of time: a phone has no daemon, so whatever must reach the user while the app is closed,
// such as reminders, is given to Android through Capacitor's local notifications. They are set again whenever the data
// changes and each time the app opens or comes back, so a moved or finished item never rings.

// ── Capacitor's shapes ───────────────────────────────────────────────────────

// Only the parts of @capacitor/local-notifications this uses, so X-App does not depend on the plugin; the app passes
// its own LocalNotifications.
export interface LocalNotificationsLike {
  getPending(): Promise<{ notifications: { id: number }[] }>;
  cancel(options: { notifications: { id: number }[] }): Promise<void>;
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: {
    notifications: {
      id: number;
      title: string;
      body: string;
      // None shows the notice at once.
      schedule?: { at: Date; allowWhileIdle: boolean };
      // False keeps Android from needing the exact-alarm leave, whose settings screen it opens otherwise.
      isExactNotification?: boolean;
      extra?: Record<string, string>;
    }[];
  }): Promise<unknown>;
  addListener(event: "localNotificationActionPerformed", listener: (action: { notification: { extra?: unknown } }) => void): Promise<unknown>;
}

// ── Notices ──────────────────────────────────────────────────────────────────

// One notice for Android to show at a set time; a tap hands its extra back to the app, such as a link to open.
export interface PhoneNotice {
  // The same item at the same time always has the same key.
  key: string;
  title: string;
  body: string;
  // Milliseconds since 1970.
  at: number;
  extra?: Record<string, string>;
}

// How far ahead notices are handed over; the app sets them again long before this runs out in everyday use.
export const notice_horizon_ms = 14 * 24 * 60 * 60 * 1000;

// Android caps how many alarms one app may hold, so only the soonest are handed over.
export const most_notices = 64;

// Android names notifications by a positive 32-bit number, so each key is hashed to one (FNV-1a).
export function notice_id(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0x7fffffff;
}

// The notices still to come, soonest first, as many as Android allows.
export function soonest_notices(notices: PhoneNotice[], now: number, most = most_notices): PhoneNotice[] {
  return notices.filter((notice) => notice.at > now).sort((first, second) => first.at - second.at).slice(0, most);
}

// ── Handing them to Android ──────────────────────────────────────────────────

export interface PhoneNoticeOptions {
  // The app's LocalNotifications.
  plugin: LocalNotificationsLike;
  // Every notice due from now until the horizon; past ones and those past Android's cap are left out here.
  read: (now: number, until: number) => PhoneNotice[] | Promise<PhoneNotice[]>;
  // A tap on a notice, with its extra.
  on_tap: (extra: Record<string, string>) => void;
  // How long refresh waits so that calls close together run once; half a second unless set.
  refresh_delay_ms?: number;
  // The clock; Date.now unless set.
  now?: () => number;
  // Told when the notices could not be set.
  on_error?: (error: unknown) => void;
  // Whether notices set ahead ring at their exact moment, which on Android needs the exact-alarm leave; true unless set.
  exact?: boolean;
}

// A notice shown at once, such as a run that just finished, so it has no moment.
export type ImmediateNotice = Omit<PhoneNotice, "at">;

export interface PhoneNotices {
  // Sets every notice again; calls close together are run once.
  refresh: () => void;
  // Asks once to show notifications, as when reminders are turned on.
  ask_permission: () => Promise<void>;
  // Shows a notice at once, with no alarm and so no exact-alarm leave; false when notifications are not allowed.
  show: (notice: ImmediateNotice) => Promise<boolean>;
}

export function keep_phone_notices(options: PhoneNoticeOptions): PhoneNotices {
  const { plugin } = options;
  const now = options.now ?? Date.now;
  const report = options.on_error ?? ((error: unknown) => console.error("could not set notices", error));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  // Everything pending is the app's own, so it is all taken back before the new set goes in.
  async function set_again(): Promise<void> {
    const pending = await plugin.getPending();
    if (pending.notifications.length > 0) await plugin.cancel({ notifications: pending.notifications.map(({ id }) => ({ id })) });
    const moment = now();
    const notices = soonest_notices(await options.read(moment, moment + notice_horizon_ms), moment);
    if (notices.length === 0 || (await plugin.checkPermissions()).display !== "granted") return;
    await plugin.schedule({
      notifications: notices.map((notice) => ({
        id: notice_id(notice.key),
        title: notice.title,
        body: notice.body,
        schedule: { at: new Date(notice.at), allowWhileIdle: true },
        isExactNotification: options.exact ?? true,
        ...(notice.extra ? { extra: notice.extra } : {}),
      })),
    });
  }

  void plugin.addListener("localNotificationActionPerformed", (action) => {
    const extra = action.notification.extra;
    if (typeof extra === "object" && extra !== null) options.on_tap(extra as Record<string, string>);
  });

  return {
    refresh: () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        running = running.then(set_again).catch(report);
      }, options.refresh_delay_ms ?? 500);
    },
    ask_permission: async () => {
      const { display } = await plugin.checkPermissions();
      if (display !== "granted" && display !== "denied") await plugin.requestPermissions();
    },
    show: async (notice) => {
      if ((await plugin.checkPermissions()).display !== "granted") return false;
      await plugin.schedule({
        notifications: [{ id: notice_id(notice.key), title: notice.title, body: notice.body, isExactNotification: false, ...(notice.extra ? { extra: notice.extra } : {}) }],
      });
      return true;
    },
  };
}
