#!/usr/bin/env node
// Stands in for gh in the tests. owner/has-match holds an open issue like the title asked for, owner/broken fails, a new issue is
// #42 with its title and body kept in a file, and signing in is kept in the file FAKE_GH_STATE names. Issues, labels,
// comments, pull requests, checks and webhooks live in the JSON file FAKE_GH_DATA names, which also logs each call.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const option = (name) => argv[argv.indexOf(name) + 1];
const repository = option("--repo");

const state = process.env.FAKE_GH_STATE;

if (argv[0] === "auth" && argv[1] === "status") {
  if (state && existsSync(state)) process.stdout.write(`github.com\n  ✓ Logged in to github.com account ${readFileSync(state, "utf8")} (keyring)\n`);
  else {
    process.stderr.write("You are not logged into any GitHub hosts. To log in, run: gh auth login\n");
    process.exit(1);
  }
} else if (argv[0] === "auth" && argv[1] === "login" && process.env.FAKE_GH_SILENT) {
  await new Promise((resolve) => setTimeout(resolve, 300));
} else if (argv[0] === "auth" && argv[1] === "login") {
  process.stderr.write("! First copy your one-time code: WXYZ-9876\nPress Enter to open https://github.com/login/device in your browser... ");
  readFileSync(0, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 200));
  writeFileSync(state, "test-user");
  process.stderr.write("\n✓ Logged in as test-user\n");
} else if (argv[0] === "auth" && argv[1] === "logout") {
  rmSync(state, { force: true });
} else if (process.env.FAKE_GH_DATA && argv[0] !== "auth") {
  const file = process.env.FAKE_GH_DATA;
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.calls = [...(data.calls ?? []), argv.filter((part) => part !== "--repo" && part !== repository)];
  const save = () => writeFileSync(file, JSON.stringify(data, null, 2));
  const fail = (message, code = 1) => {
    save();
    process.stderr.write(`${message}\n`);
    process.exit(code);
  };
  if (data.offline) fail("error connecting to api.github.com");
  const issue = () => data.issues[argv[2]] ?? fail(`GraphQL: Could not resolve to an issue with the number of ${argv[2]}.`);
  const input = () => readFileSync(0, "utf8");
  if (argv[0] === "issue" && argv[1] === "view") {
    const found = issue();
    process.stdout.write(JSON.stringify({ state: found.state, labels: found.labels.map((name) => ({ name })), body: found.body }));
  } else if (argv[0] === "issue" && argv[1] === "edit") {
    const found = issue();
    const add = argv.includes("--add-label") ? option("--add-label").split(",") : [];
    const remove = argv.includes("--remove-label") ? option("--remove-label").split(",") : [];
    for (const name of add) if (!data.labels.includes(name)) fail(`could not add label: '${name}' not found`);
    found.labels = [...found.labels.filter((name) => !remove.includes(name)), ...add.filter((name) => !found.labels.includes(name))];
    if (argv.includes("--body-file")) found.body = input();
  } else if (argv[0] === "issue" && argv[1] === "comment") {
    const found = issue();
    const id = data.next_comment_id++;
    found.comments.push({ id, body: input() });
    process.stdout.write(`https://github.com/${repository}/issues/${argv[2]}#issuecomment-${id}\n`);
  } else if (argv[0] === "issue" && argv[1] === "close") {
    issue().state = "CLOSED";
  } else if (argv[0] === "api" && argv[3].includes("/hooks")) {
    const [, owner, name, , hook_id] = argv[3].split("/");
    const hooks = ((data.hooks ??= {})[`${owner}/${name}`] ??= []);
    if (argv[2] === "GET") process.stdout.write(JSON.stringify(hooks.map(({ id, config }) => ({ id, config: { url: config.url } }))));
    else {
      const body = JSON.parse(input());
      if (argv[2] === "POST") hooks.push({ id: hooks.length + 1, ...body });
      else Object.assign(hooks.find((hook) => String(hook.id) === hook_id) ?? fail("gh: Not Found (HTTP 404)"), body);
      process.stdout.write("{}");
    }
  } else if (argv[0] === "api") {
    const id = Number(argv[3].split("/").at(-1));
    const comment = Object.values(data.issues).flatMap((each) => each.comments).find((each) => each.id === id);
    if (!comment) fail("gh: Not Found (HTTP 404)");
    comment.body = JSON.parse(input()).body;
    process.stdout.write("{}");
  } else if (argv[0] === "label" && argv[1] === "list") {
    process.stdout.write(JSON.stringify(data.labels.filter((name) => !argv.includes("--search") || name.includes(option("--search"))).map((name) => ({ name }))));
  } else if (argv[0] === "label" && argv[1] === "create") {
    if (data.labels.includes(argv[2])) fail(`label with name "${argv[2]}" already exists; use \`--force\` to update its color and description`);
    data.labels.push(argv[2]);
  } else if (argv[0] === "pr" && argv[1] === "list") {
    process.stdout.write(JSON.stringify(data.pulls.filter((pull) => pull.head === option("--head")).map(({ head: _head, ...pull }) => pull)));
  } else if (argv[0] === "pr" && argv[1] === "view") {
    const { head: _head, ...pull } = data.pulls.find((each) => String(each.number) === argv[2]);
    process.stdout.write(JSON.stringify(pull));
  } else if (argv[0] === "pr" && argv[1] === "checks") {
    const checks = data.checks[argv[2]] ?? [];
    if (!checks.length) fail(`no checks reported on the 'worktree-item' branch`);
    process.stdout.write(JSON.stringify(checks));
    save();
    process.exit(checks.some((check) => check.bucket === "pending") ? 8 : checks.some((check) => check.bucket === "fail") ? 1 : 0);
  }
  save();
} else if (repository === "owner/broken") {
  process.stderr.write("HTTP 404: Not Found\n");
  process.exit(1);
} else if (argv[0] === "issue" && argv[1] === "list") {
  const issues = repository === "owner/has-match" ? [{ number: 5, title: "Swimlanes on the board" }, { number: 6, title: "Unrelated thing" }] : [];
  process.stdout.write(JSON.stringify(issues));
} else if (argv[0] === "issue" && argv[1] === "create") {
  const record = join(tmpdir(), `x-libs-fake-gh-${repository.replace("/", "-")}.json`);
  writeFileSync(record, JSON.stringify({ title: option("--title"), body: readFileSync(0, "utf8") }));
  process.stdout.write(`https://github.com/${repository}/issues/42\n`);
}
