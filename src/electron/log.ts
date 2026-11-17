// An Electron app's main log: lines to the terminal and optionally a file, with the page's records joining them through the bridge.

import { appendFileSync } from "node:fs";
import { create_logger, format_record, is_enabled, parse_level_spec, type Level, type LevelSpec, type Logger, type LogRecord, type LogSink } from "../log.ts";
import { read_page_record, type PageLogMethods } from "../log_protocol.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface MainLogOptions {
  // The level setting, such as process.env.X_MUSIC_LOG with "warn,play:debug".
  setting?: string;
  // A file every line is added to as well, such as process.env.X_MUSIC_LOG_FILE.
  file?: string;
  // The scope the page's loggers sit under, so "page:debug" turns all of them up.
  page_scope?: string;
  // Where each line goes besides the file; info and debug to stdout and the rest to stderr unless given.
  write_line?: (line: string, level: Level) => void;
}

export interface MainLog {
  levels: LevelSpec;
  logger(scope: string): Logger;
  sink: LogSink;
  // The calls the page's bridge answers.
  methods: PageLogMethods;
  // The setting in a line, such as for the log's first record.
  describe(): string;
}

// Warnings and worse go to stderr, so they survive stdout being sent elsewhere.
function write_to_console(line: string, level: Level): void {
  if (level === "info" || level === "debug") console.log(line);
  else console.error(line);
}

// ── Main log ─────────────────────────────────────────────────────────────────

export function create_main_log(options: MainLogOptions = {}): MainLog {
  const levels = parse_level_spec(options.setting);
  const page_scope = options.page_scope ?? "page";
  const write_line = options.write_line ?? write_to_console;

  const sink: LogSink = (record) => {
    const line = format_record(record);
    write_line(line, record.level);
    if (!options.file) return;
    try {
      appendFileSync(options.file, `${line}\n`);
    } catch {
      // A log file that cannot be written must not take the app down with it.
    }
  };

  const write_log = (raw: LogRecord) => {
    const record = read_page_record(raw);
    if (!record) return;
    const scope = record.scope === "" ? page_scope : `${page_scope}.${record.scope}`;
    if (is_enabled(levels, scope, record.level)) sink({ ...record, scope });
  };

  return {
    levels,
    logger: (scope) => create_logger(scope, levels, sink),
    sink,
    methods: { write_log, get_log_levels: () => levels },
    describe: () => [
      `level=${levels.default}`,
      ...Object.entries(levels.scopes).map(([scope, level]) => `${scope}=${level}`),
      ...(options.file ? [`file=${options.file}`] : []),
    ].join(" "),
  };
}
