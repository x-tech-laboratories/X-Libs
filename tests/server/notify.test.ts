import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { apprise_urls, send_apprise } from "../../src/server/notify/apprise.ts";
import { deliver } from "../../src/server/notify/http.ts";
import { mail_settings, send_mail, transport_options } from "../../src/server/notify/mail.ts";
import { ntfy_priority, ntfy_settings, ntfy_tags, send_ntfy } from "../../src/server/notify/ntfy.ts";
import { list_setting, per_key, setting_secret } from "../../src/server/notify/settings.ts";
import { fill_placeholders, send_webhook, webhook_settings } from "../../src/server/notify/webhook.ts";

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

// A fetch that keeps each request and answers with the status given.
function recording_fetch(status = 200, text = "ok"): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const stand_in = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(text, { status });
  }) as unknown as typeof fetch;
  return { fetch: stand_in, sent };
}

function temp_file(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "notify-")), "secret");
  writeFileSync(path, text);
  return path;
}

describe("settings", () => {
  it("reads a secret from its file, trimmed, before the inline value", () => {
    expect(setting_secret({ token: "inline", token_file: temp_file("from-file\n") }, "token")).toBe("from-file");
    expect(setting_secret({ token: "inline" }, "token")).toBe("inline");
    expect(setting_secret({}, "token")).toBeNull();
    expect(() => setting_secret({ token_file: "/no/such/file" }, "token")).toThrow(/could not read token_file/);
  });

  it("takes a setting once for every key or per key over the defaults", () => {
    const defaults = { failed: "high", recovered: "low" };
    expect(per_key("max", defaults, "priority")).toEqual({ failed: "max", recovered: "max" });
    expect(per_key({ failed: "max" }, defaults, "priority")).toEqual({ failed: "max", recovered: "low" });
    expect(per_key(undefined, defaults, "priority")).toEqual(defaults);
    expect(() => per_key({ bogus: 1 }, defaults, "priority")).toThrow("`priority` keys must be failed, recovered, not [\"bogus\"]");
  });

  it("reads a list or a comma-separated string", () => {
    expect(list_setting("a@x, b@x ,")).toEqual(["a@x", "b@x"]);
    expect(list_setting([" a@x ", ""])).toEqual(["a@x"]);
    expect(list_setting(undefined)).toEqual([]);
  });
});

describe("deliver", () => {
  it("fails with the status and the start of the reply when the server refuses", async () => {
    const { fetch } = recording_fetch(500, "x".repeat(300));
    await expect(deliver({ method: "POST", url: "http://hook", fetch })).rejects.toThrow(`HTTP 500: ${"x".repeat(200)}`);
  });
});

describe("webhook", () => {
  it("sends the default body as JSON with the bearer token", async () => {
    const settings = webhook_settings({ url: "http://hook", bearer_token: "secret", headers: { "X-One": 1 } });
    const { fetch, sent } = recording_fetch();
    await send_webhook(settings, { values: {}, default_body: { title: "t" }, fetch });
    expect(sent[0]).toMatchObject({ url: "http://hook", method: "POST", body: "{\"title\":\"t\"}" });
    expect(sent[0]!.headers).toEqual({ "Content-Type": "application/json", "X-One": "1", Authorization: "Bearer secret" });
  });

  it("fills a template, sending a string as plain text and leaving unknown names", async () => {
    const { fetch, sent } = recording_fetch();
    await send_webhook(webhook_settings({ url: "http://hook", method: "put", payload: "{title} {nope}" }), { values: { title: "Down" }, default_body: null, fetch });
    expect(sent[0]).toMatchObject({ method: "PUT", body: "Down {nope}" });
    expect(sent[0]!.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(fill_placeholders({ list: ["{a}"], deep: { n: 3, s: "{a}!" } }, { a: "x" })).toEqual({ list: ["x"], deep: { n: 3, s: "x!" } });
  });

  it("refuses a missing url, a bad method and headers that are not a mapping", () => {
    expect(() => webhook_settings({})).toThrow("a webhook channel needs `url` or `url_file`");
    expect(() => webhook_settings({ url: "u", method: "get" })).toThrow("`method` must be POST, PUT or PATCH, not \"GET\"");
    expect(() => webhook_settings({ url: "u", headers: ["x"] })).toThrow("`headers` must be a mapping");
  });
});

describe("ntfy", () => {
  it("publishes JSON to the server with the topic, priority, tags and link", async () => {
    const { fetch, sent } = recording_fetch();
    const settings = ntfy_settings({ url: "https://push.example/", topic: "alerts", token: "tk" });
    await send_ntfy(settings, { title: "Down", message: "", priority: 5, tags: ["warning"], click: "http://x/m" }, { fetch });
    expect(sent[0]!.url).toBe("https://push.example");
    expect(JSON.parse(sent[0]!.body)).toEqual({ topic: "alerts", title: "Down", message: "Down", priority: 5, tags: ["warning"], click: "http://x/m" });
    expect(sent[0]!.headers.Authorization).toBe("Bearer tk");
  });

  it("signs in with a name and password in place of a token", () => {
    const settings = ntfy_settings({ topic: "t", token: "tk", username: "me", password: "pw" });
    expect(settings.url).toBe("https://ntfy.sh");
    expect(settings.headers.Authorization).toBe(`Basic ${Buffer.from("me:pw").toString("base64")}`);
  });

  it("reads priorities by name or number and tags as a list or a string", () => {
    expect(ntfy_priority("urgent")).toBe(5);
    expect(ntfy_priority(2)).toBe(2);
    expect(() => ntfy_priority(9)).toThrow(/`priority` must be 1-5/);
    expect(ntfy_tags("a, b,")).toEqual(["a", "b"]);
    expect(() => ntfy_settings({})).toThrow("an ntfy channel needs `topic` or `topic_file`");
  });
});

describe("mail", () => {
  it("reads its settings with the port its security implies", () => {
    const settings = mail_settings({ host: "smtp.example", security: "TLS", username: "me@example", to: "a@x, b@x" });
    expect(settings).toMatchObject({ port: 465, security: "tls", from: "me@example", to: ["a@x", "b@x"], subject_prefix: "" });
    expect(() => mail_settings({})).toThrow("an smtp channel needs `host`");
    expect(() => mail_settings({ host: "h", security: "ssl" })).toThrow("`security` must be starttls, tls or none, not \"ssl\"");
    expect(() => mail_settings({ host: "h", to: "a@x" })).toThrow(/needs `from`/);
    expect(() => mail_settings({ host: "h", from: "f@x" })).toThrow(/needs `to`/);
  });

  it("requires STARTTLS and signs in only with both a name and a password", () => {
    const options = transport_options(mail_settings({ host: "h", from: "f@x", to: "a@x", username: "me", password: "pw" }));
    expect(options).toMatchObject({ port: 587, secure: false, requireTLS: true, ignoreTLS: false, auth: { user: "me", pass: "pw" } });
    expect(transport_options(mail_settings({ host: "h", from: "f@x", to: "a@x", username: "me", security: "none" }))).not.toHaveProperty("auth");
  });

  it("sends one plain-text message to every address with the subject prefix", async () => {
    const sent: unknown[] = [];
    let closed = false;
    const settings = mail_settings({ host: "h", from: "f@x", to: ["a@x", "b@x"], subject_prefix: "[mon] " });
    await send_mail(settings, { subject: "Down", text: "body" }, () => ({ sendMail: async (mail) => sent.push(mail), close: () => { closed = true; } }));
    expect(sent).toEqual([{ from: "f@x", to: "a@x, b@x", subject: "[mon] Down", text: "body" }]);
    expect(closed).toBe(true);
  });

  it("builds a real message through nodemailer", async () => {
    const nodemailer = await import("nodemailer");
    const settings = mail_settings({ host: "h", from: "f@x", to: "a@x" });
    let raw = "";
    await send_mail(settings, { subject: "Hi", text: "there" }, () => {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
      return { sendMail: async (mail) => { raw = String(((await transport.sendMail(mail)) as { message: Buffer }).message); } };
    });
    expect(raw).toContain("Subject: Hi");
    expect(raw).toContain("there");
  });
});

describe("apprise", () => {
  it("reads URLs inline and from a file, skipping comments", () => {
    const file = temp_file("# chat\nntfys://topic\n\n");
    expect(apprise_urls({ urls: "mailto://me", urls_file: file })).toEqual(["mailto://me", "ntfys://topic"]);
    expect(() => apprise_urls({})).toThrow("an apprise channel needs `urls` or `urls_file`");
    expect(() => apprise_urls({ urls: ["not a url"] })).toThrow("an apprise URL was not recognised; check its scheme and format");
  });

  it("hands the URLs over in the environment, never on the command line", async () => {
    const calls: { argv: readonly string[]; urls: string | undefined }[] = [];
    await send_apprise(["tgram://secret/1"], { title: "T", body: "", type: "failure" }, {
      run: async (argv, options) => {
        calls.push({ argv, urls: options.env?.APPRISE_URLS });
        return { exit_code: 0, stdout: "", stderr: "" };
      },
    });
    expect(calls[0]!.argv).toEqual(["apprise", "--title", "T", "--body", "T", "--notification-type", "failure"]);
    expect(calls[0]!.argv.join(" ")).not.toContain("secret");
    expect(calls[0]!.urls).toBe("tgram://secret/1");
  });

  it("fails when apprise is missing or cannot deliver", async () => {
    const message = { title: "T", body: "B", type: "info" } as const;
    await expect(send_apprise(["x://y"], message, { run: async () => ({ exit_code: 127, stdout: "", stderr: "" }) })).rejects.toThrow(/not installed/);
    await expect(send_apprise(["x://y"], message, { run: async () => ({ exit_code: 1, stdout: "", stderr: "boom\nfinal reason\n" }) }))
      .rejects.toThrow("Apprise could not deliver to one or more of its URLs: final reason");
  });
});
