import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HelpRequested, read_secret_file, read_server_config } from "../../src/server/config.ts";

const spec = {
  program: "x-test-server",
  summary: "Serves X-Test as a web app.",
  env_prefix: "X_TEST",
  default_port: 3918,
  web_folder_default: "/built/web",
  options: { database: { variable: "X_TEST_DB", help: "the task database; it is made if missing", placeholder: "<file>", required: true } },
  exit_on_help: false,
} as const;

describe("server config", () => {
  it("reads the flags first, then the environment, then the defaults", () => {
    const config = read_server_config({ ...spec, argv: ["--database", "/tmp/a.db", "--port", "4000"], env: { X_TEST_HOST: "::1", X_TEST_PORT: "5000", X_TEST_TOKEN: " shh " } });
    expect(config).toMatchObject({ host: "::1", port: 4000, web_folder: "/built/web", secret: "shh", values: { database: "/tmp/a.db" } });
  });

  it("needs the required option and a real port", () => {
    expect(() => read_server_config({ ...spec, argv: [], env: {} })).toThrow(/no database given\n\nUsage: x-test-server --database <file> \[--host <address>\] \[--port <number>\] \[--web-folder <folder>\]/);
    expect(() => read_server_config({ ...spec, argv: ["--database", "a", "--port", "70000"], env: {} })).toThrow("not a port: 70000");
  });

  it("only listens on this machine without a secret", () => {
    expect(() => read_server_config({ ...spec, argv: ["--database", "a", "--host", "0.0.0.0"], env: {} })).toThrow("listening on 0.0.0.0 needs a token; set X_TEST_TOKEN_FILE or X_TEST_TOKEN");
    expect(read_server_config({ ...spec, argv: ["--database", "a", "--host", "0.0.0.0"], env: { X_TEST_TOKEN: "t" } }).host).toBe("0.0.0.0");
    expect(read_server_config({ ...spec, argv: ["--database", "a"], env: {} }).host).toBe("127.0.0.1");
  });

  it("reads the secret from the file named, without its newline", () => {
    const file = join(mkdtempSync(join(tmpdir(), "x-libs-secret-")), "token");
    writeFileSync(file, "from-file\n");
    expect(read_secret_file(file)).toBe("from-file");
    expect(read_server_config({ ...spec, argv: ["--database", "a"], env: { X_TEST_TOKEN_FILE: file } }).secret).toBe("from-file");
    writeFileSync(file, "\n");
    expect(() => read_secret_file(file)).toThrow("is empty");
    expect(() => read_secret_file(join(file, "missing"))).toThrow("Could not read the secret");
  });

  it("describes every option in the usage text and throws it for --help", () => {
    let usage = "";
    try {
      read_server_config({ ...spec, argv: ["--help"], env: {} });
    } catch (error) {
      usage = (error as HelpRequested).usage;
    }
    expect(usage).toContain("Serves X-Test as a web app. Every option can also be set in the environment:");
    expect(usage).toContain("--database    X_TEST_DB          the task database; it is made if missing");
    expect(usage).toContain("--host        X_TEST_HOST        the address to listen on (default 127.0.0.1)");
    expect(usage).toContain("--port        X_TEST_PORT        the port to listen on (default 3918)");
    expect(usage).toContain("--web-folder  X_TEST_WEB_FOLDER  the built web page (default /built/web)");
    expect(usage).toContain("The token browsers sign in with is read from the file named by X_TEST_TOKEN_FILE,\nor from X_TEST_TOKEN.");
  });

  it("takes plain HOST and PORT variables and no secret for an app with its own logins", () => {
    const config = read_server_config({
      program: "x-nix", summary: "Watches hosts.", env_prefix: "X_NIX", default_port: 7720, secret: false, argv: [],
      built_in: { host: { variable: "HOST" }, port: { variable: "PORT" } },
      options: { state_dir: { help: "where state lives", default: "state" } },
      env: { HOST: "0.0.0.0", PORT: "8000" },
    });
    expect(config).toMatchObject({ host: "0.0.0.0", port: 8000, secret: "", web_folder: "", values: { state_dir: "state" } });
    expect(config.usage).not.toContain("sign in with");
    expect(config.usage).toContain("--state-dir  X_NIX_STATE_DIR  where state lives (default state)");
  });
});
