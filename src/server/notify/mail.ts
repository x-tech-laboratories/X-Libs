// Email over SMTP on nodemailer: a plain-text message to one or more addresses, over STARTTLS, TLS from the start or
// no encryption, signed in when a name and password are given.

// ── Imports ──────────────────────────────────────────────────────────────────

import { setting_secret, list_setting } from "./settings.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export type MailSecurity = "starttls" | "tls" | "none";

export interface MailSettings {
  host: string;
  port: number;
  security: MailSecurity;
  username: string | null;
  password: string | null;
  from: string;
  to: string[];
  // Put before every subject, such as "[monitor] ".
  subject_prefix: string;
}

export interface Mail {
  subject: string;
  text: string;
}

// The part of a nodemailer transport sending uses, so a test can stand in for it.
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  close?(): void;
}

export type TransportFactory = (options: Record<string, unknown>) => MailTransport | Promise<MailTransport>;

// ── Settings ─────────────────────────────────────────────────────────────────

export const mail_timeout_in_milliseconds = 20_000;

export const security_ports: Record<MailSecurity, number> = { starttls: 587, tls: 465, none: 25 };

// Reads `host`, `security`, `port`, `username`, `password` or `password_file`, `from`, `to` and `subject_prefix`.
export function mail_settings(config: Record<string, unknown>): MailSettings {
  const host = String(config.host || "");
  if (!host) throw new Error("an smtp channel needs `host`");
  const security = String(config.security ?? "starttls").toLowerCase();
  if (!Object.hasOwn(security_ports, security)) throw new Error(`\`security\` must be starttls, tls or none, not ${JSON.stringify(security)}`);
  const port = Number(config.port || security_ports[security as MailSecurity]);
  const username = config.username ? String(config.username) : null;
  const from = String(config.from || username || "");
  if (!from) throw new Error("an smtp channel needs `from` (or a `username` to send as)");
  const to = list_setting(config.to);
  if (to.length === 0) throw new Error("an smtp channel needs `to`, one address or a list");
  return {
    host, port, security: security as MailSecurity, username, password: setting_secret(config, "password"), from, to,
    subject_prefix: String(config.subject_prefix ?? ""),
  };
}

// What nodemailer is given: STARTTLS is required rather than tried, and a name signs in only with a password.
export function transport_options(settings: MailSettings): Record<string, unknown> {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    connectionTimeout: mail_timeout_in_milliseconds,
    greetingTimeout: mail_timeout_in_milliseconds,
    socketTimeout: mail_timeout_in_milliseconds,
    ...(settings.username && settings.password ? { auth: { user: settings.username, pass: settings.password } } : {}),
  };
}

// ── Sending ──────────────────────────────────────────────────────────────────

const nodemailer_transport: TransportFactory = async (options) => {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport(options) as unknown as MailTransport;
};

export async function send_mail(settings: MailSettings, mail: Mail, create_transport: TransportFactory = nodemailer_transport): Promise<void> {
  const transport = await create_transport(transport_options(settings));
  try {
    await transport.sendMail({ from: settings.from, to: settings.to.join(", "), subject: `${settings.subject_prefix}${mail.subject}`, text: mail.text });
  } finally {
    transport.close?.();
  }
}
