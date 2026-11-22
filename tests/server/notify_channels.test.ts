import { describe, expect, it } from "vitest";

import { Notifier, read_channels } from "../../src/server/notify/channels.ts";

// A fetch that keeps each request's url and body.
function recording_fetch(): { fetch: typeof fetch; sent: { url: string; body: string }[] } {
  const sent: { url: string; body: string }[] = [];
  const stand_in = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: stand_in, sent };
}

describe("notification channels", () => {
  it("are read from the config, refusing one of no known type", () => {
    expect(read_channels(undefined)).toEqual([]);
    expect(read_channels([
      { type: "ntfy", topic: "x-nix" },
      { type: "webhook", url: "https://hooks.example/x-nix" },
      { type: "mail", host: "smtp.example", from: "app@example", to: "me@example" },
      { type: "apprise", urls: ["ntfys://x-nix"] },
    ])).toHaveLength(4);
    expect(() => read_channels([{ type: "pager" }])).toThrow("notifications[0]: `type` must be one of ntfy, webhook, mail, apprise");
    expect(() => read_channels([{ type: "ntfy" }])).toThrow(/notifications\[0\].*topic/);
  });

  it("name the config key they were read from in a mistake", () => {
    expect(() => read_channels({}, { name: "alerts" })).toThrow("`alerts` must be a list of channels");
    expect(() => read_channels(["ntfy"], { name: "alerts" })).toThrow("alerts[0] must be an object");
  });

  it("send ntfy at the level's priority and a webhook the notification as JSON", async () => {
    const { fetch, sent } = recording_fetch();
    const [ntfy, webhook] = read_channels([{ type: "ntfy", topic: "x-nix" }, { type: "webhook", url: "https://hooks.example/x-nix" }], { fetch });

    await ntfy({ title: "Overdue", body: "build is slow", level: "error" });
    await webhook({ title: "Overdue", body: "build is slow", level: "error" });

    expect(sent[0].url).toBe("https://ntfy.sh");
    expect(JSON.parse(sent[0].body)).toMatchObject({ topic: "x-nix", title: "Overdue", message: "build is slow", priority: 5 });
    expect(sent[1].url).toBe("https://hooks.example/x-nix");
    expect(JSON.parse(sent[1].body)).toEqual({ title: "Overdue", body: "build is slow", level: "error" });
  });

  it("send mail with the title as its subject and Apprise with the level's type", async () => {
    const mails: unknown[] = [];
    const runs: (readonly string[])[] = [];
    const [mail, apprise] = read_channels([
      { type: "mail", host: "smtp.example", from: "app@example", to: "me@example" },
      { type: "apprise", urls: ["ntfys://x-nix"] },
    ], {
      create_transport: () => ({ sendMail: async (sent) => void mails.push(sent) }),
      apprise: { run: async (argv) => { runs.push(argv); return { exit_code: 0, stdout: "", stderr: "" }; } },
    });

    await mail({ title: "Overdue", body: "build is slow", level: "warning" });
    await apprise({ title: "Overdue", body: "build is slow", level: "error" });

    expect(mails).toEqual([{ from: "app@example", to: "me@example", subject: "Overdue", text: "build is slow" }]);
    expect(runs[0]).toEqual(["apprise", "--title", "Overdue", "--body", "build is slow", "--notification-type", "failure"]);
  });

  it("each get the notification, one failing leaving the rest", async () => {
    const logged: string[] = [];
    let delivered = 0;
    const notifier = new Notifier([async () => { throw new Error("ntfy is down"); }, async () => void delivered++], (message) => logged.push(message));

    await notifier.send({ title: "t", body: "b", level: "warning" });

    expect(delivered).toBe(1);
    expect(logged).toEqual(["Notification channel 1 failed: ntfy is down"]);
  });
});
