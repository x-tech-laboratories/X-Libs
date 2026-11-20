import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { frontmatter_list, frontmatter_text, frontmatter_values, parse_frontmatter, write_frontmatter } from "../src/frontmatter.ts";
import { create_frontmatter_folder } from "../src/frontmatter_folder.ts";

const agent_file = ["---", "# Read by another program too.", "name: planner", "description: Plans the work", "tools: Read, Grep", "custom-key: kept", "---", "", "Plan carefully.", ""].join("\n");

describe("a frontmatter file", () => {
  it("is read into its keys and its body", () => {
    const file = parse_frontmatter(agent_file);

    expect(frontmatter_values(file)).toEqual({ name: "planner", description: "Plans the work", tools: "Read, Grep", "custom-key": "kept" });
    expect(file.body).toBe("Plan carefully.");
    expect(frontmatter_values(parse_frontmatter("---\n---\nBody only"))).toEqual({});
    expect(parse_frontmatter("---\na: 1\n---").body).toBe("");
  });

  it("is refused without frontmatter, with broken YAML, or with frontmatter that is not a set of keys", () => {
    expect(() => parse_frontmatter("Just text")).toThrow("does not start with a frontmatter block");
    expect(() => parse_frontmatter("---\ntitle: a---b\nno end")).toThrow("does not start with a frontmatter block");
    expect(() => parse_frontmatter("---\na: [1\n---\n")).toThrow("its frontmatter is not valid YAML");
    expect(() => parse_frontmatter("---\n- a\n- b\n---\n")).toThrow("not a set of keys");
  });

  it("reads values as text or lists whatever shape they were written in", () => {
    expect(frontmatter_text("a")).toBe("a");
    expect(frontmatter_text(3)).toBe("3");
    expect(frontmatter_text({})).toBe("");
    expect(frontmatter_list("Read, Grep , ,Bash")).toEqual(["Read", "Grep", "Bash"]);
    expect(frontmatter_list(["Read", 2, null])).toEqual(["Read", "2"]);
    expect(frontmatter_list(undefined)).toEqual([]);
  });

  it("is written with the app's keys set or dropped, every other key and comment kept", () => {
    const file = parse_frontmatter(agent_file);

    const text = write_frontmatter({ description: "Plans it", tools: "", order: 2, gates: ["tests", "lint"] }, "New prompt.", file.frontmatter);

    expect(text).toBe(["---", "# Read by another program too.", "name: planner", "description: Plans it", "custom-key: kept", "order: 2", "gates:", "  - tests", "  - lint", "---", "", "New prompt.", ""].join("\n"));
    expect(frontmatter_values(parse_frontmatter(agent_file))).toHaveProperty("tools");
    expect(write_frontmatter({ name: "fresh", gone: undefined }, "")).toBe("---\nname: fresh\n---\n");
    expect(write_frontmatter({ name: "x" }, "b", parse_frontmatter("---\n---\n").frontmatter)).toBe("---\nname: x\n---\n\nb\n");
  });
});

describe("a folder of frontmatter files", () => {
  const options = (folder: string, on_change?: () => void) => ({ folder, id_of_file: (name: string) => /^agent-(.+)\.md$/.exec(name)?.[1] ?? null, file_of_id: (id: string) => `agent-${id}.md`, on_change, settle_in_milliseconds: 20 });

  it("reads every file it names, notes those it cannot read, writes whole files and removes them", () => {
    const folder = join(mkdtempSync(join(tmpdir(), "x-libs-frontmatter-")), "agents");
    const files = create_frontmatter_folder(options(folder));
    expect(files.read_all()).toEqual({ files: new Map(), problems: [] });

    files.write("plan", agent_file);
    writeFileSync(join(folder, "agent-broken.md"), "no frontmatter");
    writeFileSync(join(folder, "notes.txt"), "left alone");
    const read = files.read_all();

    expect([...read.files.keys()]).toEqual(["plan"]);
    expect(read.problems).toEqual([{ file: "agent-broken.md", problem: "it does not start with a frontmatter block between --- lines" }]);
    expect(readFileSync(files.path_of("plan"), "utf8")).toBe(agent_file);
    expect(files.has("broken")).toBe(true);
    files.remove("plan");
    files.remove("plan");
    expect(files.has("plan")).toBe(false);
  });

  it("tells of changes to the files it names once they settle, until stopped", async () => {
    const folder = mkdtempSync(join(tmpdir(), "x-libs-frontmatter-"));
    const on_change = vi.fn();
    const files = create_frontmatter_folder(options(folder, on_change));
    const stop = files.watch();

    writeFileSync(join(folder, "other.txt"), "ignored");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(on_change).not.toHaveBeenCalled();
    writeFileSync(join(folder, "agent-review.md"), agent_file);
    await vi.waitFor(() => expect(on_change).toHaveBeenCalled(), { timeout: 2000 });
    stop();
  });
});
