#!/usr/bin/env node
// The `x-app-site` command: `dev` serves the site with live reloading, `build` writes it to dist/ for GitHub Pages and
// `preview` serves what was built, each for the site in the folder given or the current one.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { build_site, preview_site, serve_site } from "./build.ts";

const usage = "Usage: x-app-site <dev|build|preview> [site folder] [--port <number>]";

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { port: { type: "string" }, help: { type: "boolean", short: "h" } } });
  const [command, folder = "."] = positionals;
  if (values.help || !command) {
    console.info(usage);
    return;
  }
  const root = resolve(folder);
  const port = values.port === undefined ? undefined : Number(values.port);
  if (command === "build") await build_site(root);
  else if (command === "dev") await serve_site(root, port ?? 4321);
  else if (command === "preview") await preview_site(root, port ?? 4322);
  else throw new Error(`Unknown command "${command}". ${usage}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
