// Logging by scope and level, such as "warn,play:debug", where a mistake in the setting never silences logging.

// ── Levels ───────────────────────────────────────────────────────────────────

export type Level = "critical" | "error" | "warn" | "info" | "debug";

const level_order: Record<Level, number> = { critical: 0, error: 1, warn: 2, info: 3, debug: 4 };

export const levels = Object.keys(level_order) as Level[];

const level_aliases: Record<string, Level> = {
  crit: "critical", critical: "critical",
  err: "error", error: "error",
  warn: "warn", warning: "warn",
  info: "info",
  debug: "debug", verbose: "debug", trace: "debug",
};

export const default_level: Level = "info";

export interface LevelSpec {
  // The level for any scope without its own entry.
  default: Level;
  scopes: Record<string, Level>;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// A bare level sets the default and "scope:level" one scope; entries it cannot read are skipped.
export function parse_level_spec(spec: string | undefined, fallback: Level = default_level): LevelSpec {
  const parsed: LevelSpec = { default: fallback, scopes: {} };
  if (!spec) return parsed;

  for (const raw_part of spec.split(",")) {
    const part = raw_part.trim().toLowerCase();
    if (part === "") continue;

    // Scopes hold colons of their own, so the level follows the last one.
    const colon = part.lastIndexOf(":");
    if (colon === -1) {
      const level = level_aliases[part];
      if (level) parsed.default = level;
      continue;
    }

    const scope = part.slice(0, colon).trim();
    const level = level_aliases[part.slice(colon + 1).trim()];
    if (!level || scope === "") continue;
    if (scope === "*") parsed.default = level;
    else parsed.scopes[scope] = level;
  }
  return parsed;
}

// A scope without its own level takes its nearest dotted parent's, so "x.core" covers "x.core.db", then the default.
export function level_for(spec: LevelSpec, scope: string): Level {
  for (let name = scope; name !== ""; name = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : "") {
    const level = spec.scopes[name];
    if (level !== undefined) return level;
  }
  return spec.default;
}

export function is_enabled(spec: LevelSpec, scope: string, level: Level): boolean {
  return level_order[level] <= level_order[level_for(spec, scope)];
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface LogRecord {
  at: number;
  level: Level;
  scope: string;
  message: string;
  // Detail added as JSON after the message.
  data?: unknown;
}

export type LogSink = (record: LogRecord) => void;

const two_digits = (count: number): string => String(count).padStart(2, "0");

// A line in fixed columns, such as "10:33:35.123 WARN     play      message {"detail":1}".
export function format_record(record: LogRecord): string {
  const date = new Date(record.at);
  const time = `${two_digits(date.getHours())}:${two_digits(date.getMinutes())}:${two_digits(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`;
  let line = `${time} ${record.level.toUpperCase().padEnd(8)} ${record.scope.padEnd(9)} ${record.message}`;
  if (record.data !== undefined) {
    try {
      line += ` ${JSON.stringify(record.data)}`;
    } catch {
      line += " [unserializable]";
    }
  }
  return line;
}

// ── Loggers ──────────────────────────────────────────────────────────────────

export interface Logger {
  critical(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  // Whether the level would be written, so costly messages can be skipped.
  enabled(level: Level): boolean;
  child(scope: string): Logger;
}

// A function is read on every record, so a setting that arrives after the logger was made still applies.
export type SpecSource = LevelSpec | (() => LevelSpec);

const resolve_spec = (source: SpecSource): LevelSpec => typeof source === "function" ? source() : source;

export function create_logger(scope: string, spec: SpecSource, sink: LogSink): Logger {
  const emit = (level: Level, message: string, data?: unknown): void => {
    if (!is_enabled(resolve_spec(spec), scope, level)) return;
    sink({ at: Date.now(), level, scope, message, data });
  };
  return {
    critical: (message, data) => emit("critical", message, data),
    error: (message, data) => emit("error", message, data),
    warn: (message, data) => emit("warn", message, data),
    info: (message, data) => emit("info", message, data),
    debug: (message, data) => emit("debug", message, data),
    enabled: (level) => is_enabled(resolve_spec(spec), scope, level),
    child: (child_scope) => create_logger(`${scope}:${child_scope}`, spec, sink),
  };
}
