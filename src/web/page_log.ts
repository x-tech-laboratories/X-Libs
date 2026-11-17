// A page's loggers whose records go to the main process's log, at the levels it sets, with uncaught errors reported there too.

import { create_logger, parse_level_spec, type LevelSpec, type Logger, type LogRecord } from "../log.ts";
import type { PageLogClient } from "../log_protocol.ts";

export interface PageLogOptions {
  // Reports the page's uncaught errors and unhandled rejections under this logger; on unless false.
  report_uncaught?: boolean;
  uncaught_scope?: string;
}

export interface PageLog {
  logger(scope: string): Logger;
  // Fetches the main process's levels, which loggers made earlier follow too, and starts reporting uncaught errors.
  start(): Promise<void>;
  // Stops reporting uncaught errors.
  stop(): void;
}

// An Error keeps its name, message and stack, and anything that cannot travel as JSON is sent as text.
function plain_data(data: unknown): unknown {
  if (data === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(data, (_key, value: unknown) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value)) as unknown;
  } catch {
    return String(data);
  }
}

export function create_page_log(client: PageLogClient, options: PageLogOptions = {}): PageLog {
  let levels: LevelSpec = parse_level_spec(undefined);

  // A record that fails to send is dropped, since logging the failure would only fail again.
  const sink = (record: LogRecord) => {
    try {
      void client.write_log({ ...record, data: plain_data(record.data) }).catch(() => {});
    } catch {
      // The bridge refused the record before sending it.
    }
  };
  const logger = (scope: string) => create_logger(scope, () => levels, sink);

  const uncaught = logger(options.uncaught_scope ?? "uncaught");
  const on_error = (event: ErrorEvent) => uncaught.error(event.message, { source: event.filename, line: event.lineno, column: event.colno, error: event.error as unknown });
  const on_rejection = (event: PromiseRejectionEvent) => uncaught.error("unhandled rejection", { reason: event.reason as unknown });
  let reporting = false;

  return {
    logger,
    async start() {
      if (options.report_uncaught !== false && !reporting) {
        window.addEventListener("error", on_error);
        window.addEventListener("unhandledrejection", on_rejection);
        reporting = true;
      }
      levels = await client.get_log_levels();
    },
    stop() {
      window.removeEventListener("error", on_error);
      window.removeEventListener("unhandledrejection", on_rejection);
      reporting = false;
    },
  };
}
