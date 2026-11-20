import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { best_title_match, github_cli, title_likeness } from "../../src/agent/github.ts";

// A stand-in for gh that never reaches GitHub; it keeps its state in the files named by its environment.
const fake_gh = join(import.meta.dirname, "..", "fixtures", "fake_gh.mjs");
const gh = github_cli({ program: fake_gh });

afterEach(() => {
  delete process.env.FAKE_GH_STATE;
  delete process.env.FAKE_GH_DATA;
});

// A data file for the stand-in with one open issue, a label, a pull request with checks and no hooks.
function with_data(extra: Record<string, unknown> = {}): string {
  const file = join(mkdtempSync(join(tmpdir(), "x-libs-gh-")), "data.json");
  writeFileSync(
    file,
    JSON.stringify({
      issues: { "7": { state: "OPEN", labels: ["stage:plan"], body: "Old body", comments: [] } },
      labels: ["stage:plan"],
      next_comment_id: 100,
      pulls: [{ number: 9, url: "https://github.com/owner/repo/pull/9", state: "MERGED", isDraft: false, head: "feature" }],
      checks: { "9": [{ name: "ci", bucket: "pending", link: "https://ci", workflow: "CI" }, { name: "odd", bucket: "weird" }] },
      ...extra,
    }),
  );
  process.env.FAKE_GH_DATA = file;
  return file;
}

const read_data = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("signing gh into GitHub", () => {
  it("reads the account, signs in with the device code, and signs out", async () => {
    process.env.FAKE_GH_STATE = join(mkdtempSync(join(tmpdir(), "x-libs-gh-")), "signed-in");
    expect(await gh.account()).toEqual({ signed_in: false, account: "", problem: "" });

    const done = vi.fn();
    expect(await gh.start_sign_in(done)).toEqual({ code: "WXYZ-9876", url: "https://github.com/login/device" });
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith(true), { timeout: 5000 });
    expect(await gh.account()).toEqual({ signed_in: true, account: "test-user", problem: "" });

    await gh.sign_out("test-user");
    expect((await gh.account()).signed_in).toBe(false);
  });

  it("says when gh is missing", async () => {
    const missing = github_cli({ program: "/nonexistent/gh" });

    expect((await missing.account()).problem).toBe("/nonexistent/gh is not installed or not on the PATH");
    await expect(missing.start_sign_in(() => undefined)).rejects.toThrow("is not installed or not on the PATH");
    await expect(missing.close_issue("owner/repo", 1)).rejects.toThrow("GitHub is reached through it");
  });

  it("gives up when gh prints no code in time, and says why when gh fails first", async () => {
    process.env.FAKE_GH_SILENT = "1";
    const quiet = github_cli({ program: fake_gh, code_wait_in_milliseconds: 50 });
    await expect(quiet.start_sign_in(() => undefined)).rejects.toThrow("gh gave no sign-in code: no answer");
    delete process.env.FAKE_GH_SILENT;

    const broken = github_cli({ program: "sleep" });
    await expect(broken.start_sign_in(() => undefined)).rejects.toThrow("gh could not start signing in");
  });
});

describe("an issue for a piece of work", () => {
  it("is the open issue whose title is close enough, the closest winning", () => {
    expect(best_title_match("Board with swimlanes", [{ number: 1, title: "Swimlanes" }, { number: 2, title: "Swimlanes board" }])).toBe(2);
    expect(best_title_match("Board with swimlanes", [{ number: 3, title: "Faster sync" }])).toBeNull();
    expect(title_likeness("a b", "c d")).toBe(0);
  });

  it("is linked when one is open already, and opened with its title and body when none matches", async () => {
    expect(await gh.find_or_open_issue({ repository: "owner/has-match", title: "Swimlanes on the board", body: "" })).toEqual({ number: 5, opened: false });
    expect(await gh.find_or_open_issue({ repository: "owner/empty", title: "Board with swimlanes", body: "One lane per item." })).toEqual({ number: 42, opened: true });
    expect(JSON.parse(readFileSync(join(tmpdir(), "x-libs-fake-gh-owner-empty.json"), "utf8"))).toEqual({ title: "Board with swimlanes", body: "One lane per item." });
  });

  it("says why when GitHub cannot be reached", async () => {
    await expect(gh.find_or_open_issue({ repository: "owner/broken", title: "Board", body: "" })).rejects.toThrow("gh issue list failed: HTTP 404: Not Found");
  });

  it("is read, labelled, edited, commented on and closed", async () => {
    const file = with_data();

    expect(await gh.view_issue("owner/repo", 7)).toEqual({ open: true, labels: ["stage:plan"], body: "Old body" });
    await gh.ensure_labels("owner/repo", ["stage:plan", "stage:review"], { search: "stage:", colour: "c5def5", description: "Where the work is" });
    await gh.ensure_labels("owner/repo", ["Stage:Review"]);
    await gh.edit_issue("owner/repo", 7, { add_labels: ["stage:review"], remove_labels: ["stage:plan"], body: "New body" });
    const id = await gh.post_comment("owner/repo", 7, "A report");
    expect(await gh.update_comment("owner/repo", id, "A better report")).toBe(true);
    expect(await gh.update_comment("owner/repo", 999, "gone")).toBe(false);
    await gh.close_issue("owner/repo", 7);

    const data = read_data(file);
    expect(data.labels).toEqual(["stage:plan", "stage:review"]);
    expect(data.calls).toContainEqual(["label", "create", "stage:review", "--color", "c5def5", "--description", "Where the work is"]);
    expect(data.issues["7"]).toEqual({ state: "CLOSED", labels: ["stage:review"], body: "New body", comments: [{ id: 100, body: "A better report" }] });
  });

  it("passes on a failure that is not a missing comment or label already made", async () => {
    with_data({ offline: true });

    await expect(gh.update_comment("owner/repo", 1, "x")).rejects.toThrow("error connecting");
    await expect(gh.ensure_labels("owner/repo", ["new"])).rejects.toThrow("error connecting");
  });
});

describe("a branch's pull request", () => {
  it("is found with its state and checks, an unknown check read as pending", async () => {
    with_data();

    expect(await gh.find_pull_request("owner/repo", "feature")).toEqual({ number: 9, url: "https://github.com/owner/repo/pull/9", state: "merged", draft: false });
    expect(await gh.find_pull_request("owner/repo", "other")).toBeNull();
    expect(await gh.view_pull_request("owner/repo", 9)).toMatchObject({ number: 9, state: "merged" });
    expect(await gh.read_checks("owner/repo", 9)).toEqual([
      { name: "ci", workflow: "CI", bucket: "pending", link: "https://ci" },
      { name: "odd", workflow: "", bucket: "pending", link: "" },
    ]);
    expect(await gh.read_checks("owner/repo", 10)).toEqual([]);
  });
});

describe("a repository's webhook", () => {
  it("is added once and then updated, its secret sent on gh's input", async () => {
    const file = with_data();
    const hook = { url: "https://example.org/hook", secret: "s3", events: ["issues"] };

    expect(await gh.register_hook("owner/repo", hook)).toBe("added");
    expect(await gh.register_hook("owner/repo", { ...hook, events: ["issues", "pull_request"] })).toBe("updated");

    const data = read_data(file);
    expect(data.hooks["owner/repo"]).toHaveLength(1);
    expect(data.hooks["owner/repo"][0].events).toEqual(["issues", "pull_request"]);
    expect(JSON.stringify(data.calls)).not.toContain("s3");
  });
});
