// A server's settings from the command line and the environment: the address and port, the web folder, the app's own
// options, and the secret browsers sign in with, read from a file or a variable. Without a secret the server may only
// listen on this machine.

// ── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ConfigOption {
  // The environment variable in full; the prefix and the option's name in capitals unless set.
  variable?: string;
  // The command-line flag without its dashes; the option's name with dashes unless set.
  flag?: string;
  // What the usage text says the option is.
  help: string;
  // What the usage text shows as the value, such as "<file>"; "<value>" unless set.
  placeholder?: string;
  default?: string;
  required?: boolean;
}

export interface ServerConfigSpec<Name extends string = never> {
  // The command the usage text names.
  program: string;
  // The usage text's one line about the server.
  summary: string;
  // The start of every variable, such as "X_TASKS".
  env_prefix: string;
  default_port: number;
  // The app's own options.
  options?: Record<Name, ConfigOption>;
  // Changes to host, port and web_folder, such as a plain HOST variable.
  built_in?: Partial<Record<BuiltInName, Partial<ConfigOption>>>;
  // The web folder when none is given; without it there is no web folder option.
  web_folder_default?: string;
  // What the secret is called, such as "token" for X_TASKS_TOKEN and X_TASKS_TOKEN_FILE; false reads no secret.
  secret?: string | false;
  // The command line and environment read; the process's own unless set.
  argv?: string[];
  env?: Record<string, string | undefined>;
  // Whether --help prints the usage text and exits; off makes it throw HelpRequested instead.
  exit_on_help?: boolean;
}

export interface ServerConfig<Name extends string = never> {
  host: string;
  port: number;
  web_folder: string;
  // The secret, or "" when none is set.
  secret: string;
  // The app's own options, by name.
  values: Record<Name, string | undefined>;
  usage: string;
}

type BuiltInName = "host" | "port" | "web_folder";

export class HelpRequested extends Error {
  readonly usage: string;

  constructor(usage: string) {
    super(usage);
    this.usage = usage;
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const loopback_hosts = ["127.0.0.1", "::1", "localhost"];

export function is_loopback(host: string): boolean {
  return loopback_hosts.includes(host);
}

// ── Secrets ──────────────────────────────────────────────────────────────────

// The file's text without its final newline; an unreadable or empty file is an error.
export function read_secret_file(path: string): string {
  let secret: string;
  try {
    secret = readFileSync(path, "utf8").replace(/\r?\n$/, "");
  } catch (error) {
    throw new Error(`Could not read the secret at ${path}: ${(error as Error).message}`);
  }
  if (secret.trim() === "") throw new Error(`The secret at ${path} is empty`);
  return secret.trim();
}

// ── Reading ──────────────────────────────────────────────────────────────────

function capitals(name: string): string {
  return name.replaceAll("-", "_").toUpperCase();
}

function usage_text(program: string, summary: string, options: Record<string, Required<Pick<ConfigOption, "variable" | "flag" | "help" | "placeholder">> & ConfigOption>, secret_note: string): string {
  const entries = Object.values(options);
  const synopsis = entries
    .map((option) => (option.required ? `--${option.flag} ${option.placeholder}` : `[--${option.flag} ${option.placeholder}]`))
    .join(" ");
  const flag_width = Math.max(...entries.map((option) => option.flag.length)) + 2;
  const variable_width = Math.max(...entries.map((option) => option.variable.length));
  const rows = entries.map((option) => {
    const suffix = option.default === undefined ? "" : ` (default ${option.default})`;
    return `  ${`--${option.flag}`.padEnd(flag_width)}  ${option.variable.padEnd(variable_width)}  ${option.help}${suffix}`;
  });
  return `Usage: ${program} ${synopsis}\n\n${summary} Every option can also be set in the environment:\n${rows.join("\n")}${secret_note}`;
}

export function read_server_config<Name extends string = never>(spec: ServerConfigSpec<Name>): ServerConfig<Name> {
  const { env_prefix, argv = process.argv.slice(2), env = process.env, exit_on_help = true } = spec;
  const secret_name = spec.secret === undefined ? "token" : spec.secret;
  const own = (spec.options ?? {}) as Record<string, ConfigOption>;
  const changes = spec.built_in ?? {};

  const built_in: Record<string, ConfigOption> = {
    host: { help: "the address to listen on", placeholder: "<address>", default: "127.0.0.1", ...changes.host },
    port: { help: "the port to listen on", placeholder: "<number>", default: String(spec.default_port), ...changes.port },
  };
  if (spec.web_folder_default !== undefined) {
    built_in.web_folder = { help: "the built web page", placeholder: "<folder>", default: spec.web_folder_default, ...changes.web_folder };
  }

  const options = Object.fromEntries(
    Object.entries({ ...own, ...built_in }).map(([name, option]) => [name, {
      ...option,
      variable: option.variable ?? `${env_prefix}_${capitals(name)}`,
      flag: option.flag ?? name.replaceAll("_", "-"),
      placeholder: option.placeholder ?? "<value>",
    }]),
  );
  const secret_note = secret_name === false ? "" : `\n\nThe ${secret_name} browsers sign in with is read from the file named by ${env_prefix}_${capitals(secret_name)}_FILE,\nor from ${env_prefix}_${capitals(secret_name)}. Without one the server only listens on this machine.`;
  const usage = usage_text(spec.program, spec.summary, options, secret_note);

  const { values: flags } = parseArgs({
    args: argv,
    options: { ...Object.fromEntries(Object.values(options).map((option) => [option.flag, { type: "string" as const }])), help: { type: "boolean" as const } },
  }) as { values: Record<string, string | boolean | undefined> };
  if (flags.help) {
    if (!exit_on_help) throw new HelpRequested(usage);
    console.log(usage);
    process.exit(0);
  }

  const value_of = (name: string): string | undefined => {
    const option = options[name];
    return (flags[option.flag] as string | undefined) ?? env[option.variable] ?? option.default;
  };
  for (const [name, option] of Object.entries(options)) {
    if (option.required && value_of(name) === undefined) throw new Error(`no ${option.flag} given\n\n${usage}`);
  }

  const port_text = value_of("port")!;
  const port = Number(port_text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${port_text}`);

  let secret = "";
  if (secret_name !== false) {
    const secret_file = env[`${env_prefix}_${capitals(secret_name)}_FILE`];
    secret = secret_file ? read_secret_file(secret_file) : (env[`${env_prefix}_${capitals(secret_name)}`] ?? "").trim();
  }

  const host = value_of("host")!;
  if (secret_name !== false && secret === "" && !is_loopback(host)) {
    throw new Error(`listening on ${host} needs a ${secret_name}; set ${env_prefix}_${capitals(secret_name)}_FILE or ${env_prefix}_${capitals(secret_name)}`);
  }

  return {
    host,
    port,
    web_folder: "web_folder" in options ? value_of("web_folder")! : "",
    secret,
    values: Object.fromEntries(Object.keys(own).map((name) => [name, value_of(name)])) as Record<Name, string | undefined>,
    usage,
  };
}
