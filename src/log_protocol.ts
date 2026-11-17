// What an Electron page and its main process say about logging, so the page's records land in the main process's one log.

import { levels, type Level, type LevelSpec, type LogRecord } from "./log.ts";

export interface PageLogMethods {
  // One record from the page, written by the main process if its level allows.
  write_log: (record: LogRecord) => void;
  // The main process's level setting, since a page cannot read the environment.
  get_log_levels: () => LevelSpec;
}

export const page_log_method_names = ["write_log", "get_log_levels"] as const satisfies readonly (keyof PageLogMethods)[];

// The same calls as the page makes them, each answered later, as a bridge's client gives them.
export type PageLogClient = { [Name in keyof PageLogMethods]: (...args: Parameters<PageLogMethods[Name]>) => Promise<Awaited<ReturnType<PageLogMethods[Name]>>> };

// A record from a page, which the main process does not trust, or null when it is not one.
export function read_page_record(raw: unknown): LogRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<Record<keyof LogRecord, unknown>>;
  if (!levels.includes(record.level as Level) || typeof record.scope !== "string" || typeof record.message !== "string") return null;
  return {
    at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : Date.now(),
    level: record.level as Level,
    scope: record.scope,
    message: record.message,
    ...(record.data === undefined ? {} : { data: record.data }),
  };
}
