import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { create_secret_file, has_secret_file, read_secret_file } from "../../src/server/config.ts";
import { AddressLockout } from "../../src/server/forge_webhook.ts";
import { create_github_receiver, delivery_id_of, is_repository_name, payload_url_of, read_public_url, read_targets, repository_of, targets_of, type GitHubDelivery } from "../../src/server/github_webhook.ts";

const repository = { full_name: "owner/repo" };

describe("what a delivery names", () => {
  it("reads the repository and the pull requests, branches and issues of each event, and nothing else", () => {
    expect(targets_of("pull_request", { repository, number: 12, pull_request: { head: { ref: "topic-7", repo: repository } } })).toEqual({ repository: "owner/repo", pull_requests: [12], branches: ["topic-7"], issues: [] });
    // A fork's branch is not the repository's own.
    expect(targets_of("pull_request", { repository, pull_request: { number: 3, head: { ref: "main", repo: { full_name: "someone/fork" } } } })?.branches).toEqual([]);
    expect(targets_of("check_suite", { repository, check_suite: { head_branch: "topic", pull_requests: [{ number: 4 }, { number: "5" }] } })).toEqual({ repository: "owner/repo", pull_requests: [4], branches: ["topic"], issues: [] });
    expect(targets_of("check_run", { repository, check_run: { check_suite: { head_branch: "topic" }, pull_requests: [{ number: 4 }] } })).toEqual({ repository: "owner/repo", pull_requests: [4], branches: ["topic"], issues: [] });
    expect(targets_of("workflow_run", { repository, workflow_run: { head_branch: "topic", pull_requests: [] } })?.branches).toEqual(["topic"]);
    expect(targets_of("status", { repository, branches: [{ name: "a" }, { name: "a" }, { name: "$(rm -rf ~)" }, { name: "../up" }, { name: "-x" }] })?.branches).toEqual(["a"]);
    expect(targets_of("status", { repository, branches: "not a list" })?.branches).toEqual([]);
    expect(targets_of("issues", { repository, issue: { number: 7 } })?.issues).toEqual([7]);
    expect(targets_of("issue_comment", { repository, issue: { number: 7 }, comment: { body: "run this" } })).toEqual({ repository: "owner/repo", pull_requests: [], branches: [], issues: [7] });
    expect(targets_of("ping", { repository, zen: "Keep it simple." })).toEqual({ repository: "owner/repo", pull_requests: [], branches: [], issues: [] });
  });

  it("follows no other event, and no payload without a repository that looks like one", () => {
    expect(targets_of("push", { repository })).toBeNull();
    expect(targets_of("issues", { issue: { number: 7 } })).toBeNull();
    expect(targets_of("issues", { repository: { full_name: "owner/repo; echo" } })).toBeNull();
    expect(targets_of("issues", null)).toBeNull();
    expect(repository_of([])).toBeNull();
    expect(is_repository_name("owner/repo")).toBe(true);
    expect(is_repository_name("owner")).toBe(false);
  });

  it("reads stored targets, ids and addresses as given or not at all", () => {
    expect(read_targets("owner/repo", "not json")).toEqual({ repository: "owner/repo", pull_requests: [], branches: [], issues: [] });
    expect(read_targets("owner/repo", JSON.stringify({ pull_requests: [1, -2], branches: ["a", 3], issues: [4] }))).toEqual({ repository: "owner/repo", pull_requests: [1], branches: ["a"], issues: [4] });
    expect(delivery_id_of("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toBe("72d3162e-cc78-11e3-81ab-4c9367dc0958");
    expect(delivery_id_of("bad id")).toBe("");
    expect(payload_url_of("https://example.org/", "/api/github/webhook")).toBe("https://example.org/api/github/webhook");
    expect(payload_url_of(" ", "/hook")).toBe("");
    expect(read_public_url(" https://example.org/app/ ")).toBe("https://example.org/app");
    expect(read_public_url("")).toBe("");
    expect(() => read_public_url("ftp://example.org")).toThrow(/http or https/);
    expect(() => read_public_url("https://user@example.org")).toThrow(/http or https/);
    expect(() => read_public_url("not an address")).toThrow(/such as https/);
  });
});

describe("taking a delivery", () => {
  const key = "test-key";
  const sign = (body: string, with_key = key) => `sha256=${createHmac("sha256", with_key).update(body).digest("hex")}`;
  const headers = (body: string, event: string, delivery = "", signature = sign(body)) => ({ "x-hub-signature-256": signature, "x-github-event": event, "content-type": "application/json", ...(delivery ? { "x-github-delivery": delivery } : {}) });

  function receiver(secret = key, options: { remembered?: number } = {}) {
    const deliveries: GitHubDelivery[] = [];
    const receive = create_github_receiver({ secret: () => secret, on_delivery: (delivery) => deliveries.push(delivery), lockout: new AddressLockout({ failures_allowed: 2 }), ...options });
    return { receive, deliveries };
  }

  it("refuses every delivery without a secret, and any without GitHub's own signature of the body", () => {
    const body = JSON.stringify({ repository, issue: { number: 1 } });

    expect(receiver("").receive("1.1.1.1", headers(body, "issues"), Buffer.from(body)).status).toBe(401);
    const { receive, deliveries } = receiver();
    expect(receive("1.1.1.2", headers(body, "issues", "", sign(body, "other")), Buffer.from(body)).status).toBe(401);
    expect(receive("1.1.1.3", { authorization: `Bearer ${key}`, "x-github-event": "issues" }, Buffer.from(body)).status).toBe(401);
    expect(receive("1.1.1.4", { "x-gitea-signature": sign(body).slice(7), "x-github-event": "issues" }, Buffer.from(body)).body.message).toContain("not signed");
    expect(deliveries).toEqual([]);
  });

  it("passes on a signed delivery once, answering a replay of its id without passing it again", () => {
    const { receive, deliveries } = receiver("test-key", { remembered: 1 });
    const body = JSON.stringify({ repository, issue: { number: 1 } });

    expect(receive("1.1.1.1", headers(body, "Issues", "d-1"), Buffer.from(body))).toEqual({ status: 202, body: { message: "Received." } });
    expect(receive("1.1.1.1", headers(body, "issues", "d-1"), Buffer.from(body))).toEqual({ status: 200, body: { message: "Already received." } });
    receive("1.1.1.1", headers(body, "issues", "d-2"), Buffer.from(body));
    receive("1.1.1.1", headers(body, "issues", "d-1"), Buffer.from(body));
    receive("1.1.1.1", headers(body, "issues"), Buffer.from(body));

    expect(deliveries.map((each) => each.delivery_id)).toEqual(["d-1", "d-2", "d-1", ""]);
    expect(deliveries[0]).toEqual({ delivery_id: "d-1", event: "issues", targets: { repository: "owner/repo", pull_requests: [], branches: [], issues: [1] } });
  });

  it("answers a ping, and ignores events it does not follow or payloads naming nothing", () => {
    const { receive, deliveries } = receiver();
    const body = JSON.stringify({ repository });

    expect(receive("1.1.1.1", headers(body, "ping"), Buffer.from(body)).body.message).toBe("Pong.");
    expect(receive("1.1.1.1", headers(body, "push"), Buffer.from(body)).status).toBe(204);
    expect(receive("1.1.1.1", { ...headers("x", "issues"), "x-github-event": undefined }, Buffer.from("x")).status).toBe(204);
    expect(deliveries.map((each) => each.event)).toEqual(["ping"]);
  });

  it("turns away an address that keeps failing to sign, and lets one through that signs in time", () => {
    const { receive } = receiver();
    const body = JSON.stringify({ repository });

    receive("2.2.2.2", headers(body, "ping", "", "sha256=00"), Buffer.from(body));
    expect(receive("2.2.2.2", headers(body, "ping"), Buffer.from(body)).status).toBe(202);
    receive("2.2.2.2", headers(body, "ping", "", "sha256=00"), Buffer.from(body));
    receive("2.2.2.2", headers(body, "ping", "", "sha256=00"), Buffer.from(body));

    expect(receive("2.2.2.2", headers(body, "ping"), Buffer.from(body)).status).toBe(429);
    expect(receive("3.3.3.3", headers(body, "ping"), Buffer.from(body)).status).toBe(202);
  });
});

describe("a secret made for the app", () => {
  it("is random, kept where only its owner reads it, tightened over an older file, and read back only on request", () => {
    const path = join(mkdtempSync(join(tmpdir(), "x-libs-secret-")), "nested", "webhook-secret");
    expect(has_secret_file(path)).toBe(false);

    create_secret_file(path);
    const first = read_secret_file(path);
    writeFileSync(path, "old\n", { mode: 0o644 });
    create_secret_file(path, 16);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(read_secret_file(path)).toMatch(/^[0-9a-f]{32}$/);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(has_secret_file(path)).toBe(true);
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });
});
