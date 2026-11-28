import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { create_mcp_client, instructions_of, passed_variables, result_text, type McpServerTarget } from "../../src/server/mcp_client.ts";
import { start_fake_mcp_http, type FakeMcpHttp } from "./fake_mcp_server.ts";

const fake_program = fileURLToPath(new URL("./fake_mcp_server.ts", import.meta.url));
const client = create_mcp_client({ name: "X-Test", version: "1.0.0" });
const saved_limits = { ...client.limits };
const servers: FakeMcpHttp[] = [];

afterEach(async () => {
  await client.forget();
  Object.assign(client.limits, saved_limits);
  for (const server of servers.splice(0)) await server.close();
});

function stdio(name: string, args: string[] = [], extra: Partial<McpServerTarget> = {}): McpServerTarget {
  return { id: name.toLowerCase(), name, transport: "stdio", command: process.execPath, args: [fake_program, ...args], ...extra };
}

async function http(token = ""): Promise<FakeMcpHttp> {
  const server = await start_fake_mcp_http(token);
  servers.push(server);
  return server;
}

const never = () => new AbortController().signal;

describe("an MCP client over stdio", () => {
  it("lists a local server's tools with its instructions, cutting long words, and runs them", async () => {
    const listing = await client.list_tools(stdio("Notes"));
    expect(listing.instructions).toBe("Notes are kept by room; read one by its id.");
    const read = listing.tools.find((tool) => tool.name === "read_note")!;
    expect(read.read_only).toBe(true);
    expect(read.description).toHaveLength(client.limits.max_description);
    expect(read.input_schema).toMatchObject({ type: "object", required: ["id"] });
    expect(listing.tools.find((tool) => tool.name === "add_note")!.read_only).toBe(false);
    expect(listing.tools.find((tool) => tool.name === "env_names")!.description).toBe("Variables");
    expect(await client.call_tool(stdio("Notes"), "read_note", { id: "7" }, never())).toBe("Note 7: lay tiles from the middle.");
    expect(client.open_connections()).toBe(1);
    await expect(client.call_tool(stdio("Notes"), "fail", {}, never())).rejects.toThrow("It broke.");
  }, 30_000);

  it("passes only the safe variables and those named", async () => {
    process.env.X_TEST_PASSED = "yes";
    process.env.X_TEST_KEPT = "no";
    try {
      const names = (await client.call_tool(stdio("Env", [], { variables: ["X_TEST_PASSED", "X_TEST_MISSING"] }), "env_names", {}, never())).split(",");
      expect(names).toContain("X_TEST_PASSED");
      expect(names).not.toContain("X_TEST_KEPT");
      for (const name of names) expect(["X_TEST_PASSED", "HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]).toContain(name);
      expect(passed_variables(["A", "B"], { A: "1" })).toEqual({ A: "1" });
    } finally {
      delete process.env.X_TEST_PASSED;
      delete process.env.X_TEST_KEPT;
    }
  }, 30_000);

  it("stops a call when asked or when it hangs, and starts afresh after", async () => {
    const server = stdio("Notes");
    const stop = new AbortController();
    const waiting = client.call_tool(server, "wait", {}, stop.signal);
    setTimeout(() => stop.abort(), 100);
    await expect(waiting).rejects.toThrow("Stopped.");
    expect(client.open_connections()).toBe(0);
    client.limits.call_ms = 200;
    await expect(client.call_tool(server, "wait", {}, never())).rejects.toThrow(/Notes failed: .*timed out/i);
    expect(client.open_connections()).toBe(0);
    expect(await client.call_tool(server, "read_note", { id: "1" }, never())).toContain("Note 1");
  }, 30_000);

  it("refuses a server that exits, hangs or cannot be found, keeping nothing", async () => {
    await expect(client.list_tools(stdio("Broken", ["exit"]))).rejects.toThrow(/Broken stopped: it exited or closed its connection\. It wrote: Missing its configuration file\./);
    client.limits.connect_ms = 500;
    await expect(client.list_tools(stdio("Stuck", ["hang"]))).rejects.toThrow("Stuck did not answer within 0.5 seconds.");
    await expect(client.list_tools({ id: "gone", name: "Gone", transport: "stdio", command: "/nonexistent/mcp-server" })).rejects.toThrow("Gone could not be started: /nonexistent/mcp-server was not found.");
    // A command with shell syntax in it is a program name, never run by a shell.
    await expect(client.list_tools({ id: "shell", name: "Shell", transport: "stdio", command: "echo hi; touch /tmp/never" })).rejects.toThrow("could not be started");
    expect(client.open_connections()).toBe(0);
  }, 30_000);

  it("starts a server again once its settings change, and closes an idle one", async () => {
    await client.list_tools(stdio("Notes"));
    await client.list_tools(stdio("Notes", [], { variables: ["HOME"] }));
    expect(client.open_connections()).toBe(1);
    await client.forget("notes");
    expect(client.open_connections()).toBe(0);
    client.limits.idle_ms = 50;
    await client.list_tools(stdio("Notes"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(client.open_connections()).toBe(0);
  }, 30_000);
});

describe("an MCP client over HTTP", () => {
  it("sends the token as a bearer header, and says a refused or missing token plainly without it", async () => {
    const server = await http("made-up-token");
    const target: McpServerTarget = { id: "web", name: "Web notes", transport: "http", address: server.address, token: "made-up-token" };
    expect((await client.list_tools(target)).tools.map((tool) => tool.name)).toContain("read_note");
    expect(server.authorizations).toContain("Bearer made-up-token");
    expect(await client.call_tool(target, "add_note", { text: "Buy grout" }, never())).toBe("Added “Buy grout”.");
    const refused = client.list_tools({ ...target, id: "other", token: "" });
    await expect(refused).rejects.toThrow("Web notes refused the token.");
  });

  it("says plainly when nothing answers at the address", async () => {
    const server = await http();
    const address = server.address;
    await server.close();
    servers.length = 0;
    await expect(client.list_tools({ id: "down", name: "Down", transport: "http", address })).rejects.toThrow(`Down could not be reached at ${new URL(address).host}.`);
  });
});

describe("an MCP server's answers", () => {
  it("are read whole: text, resources and what else it gave, in words", () => {
    expect(result_text({ content: [{ type: "text", text: "One" }, { type: "image", data: "", mimeType: "image/png" }, { type: "resource", resource: { uri: "file:///a", text: "Two" } }, { type: "resource_link", uri: "file:///b", name: "b" }] })).toBe("One\n[image]\nTwo\n[b: file:///b]");
    expect(result_text({ content: [], structuredContent: { a: 1 } })).toBe('{"a":1}');
    expect(result_text({ content: [] })).toBe("(No answer.)");
    expect(instructions_of(undefined)).toBe("");
    expect(instructions_of("x".repeat(2050))).toHaveLength(2000);
    expect(instructions_of(" short ", 3)).toBe("sh…");
  });
});
