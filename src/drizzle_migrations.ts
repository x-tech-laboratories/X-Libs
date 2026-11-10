#!/usr/bin/env node
// The `x-libs-bundle-migrations <folder>` command: turns the migrations drizzle-kit wrote into a folder, one
// `<time>_<name>/migration.sql` each, into `<folder>/index.ts`, so a server that runs .ts files and a page alike import them.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { DrizzleMigration } from "./drizzle.ts";

// ── Reading ──────────────────────────────────────────────────────────────────

const breakpoint = "--> statement-breakpoint";

// The folder's migrations, oldest first, each split into its statements.
export function read_migrations(folder: string): DrizzleMigration[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "migration.sql")))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      statements: readFileSync(join(folder, name, "migration.sql"), "utf8")
        .split(breakpoint)
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ""),
    }));
}

// ── Writing ──────────────────────────────────────────────────────────────────

export function migrations_module(migrations: readonly DrizzleMigration[]): string {
  return [
    "// Written by x-libs-bundle-migrations from the migration folders beside it; run it again after drizzle-kit generate.",
    "",
    'import type { DrizzleMigration } from "@x-tech-laboratories/x-libs/drizzle";',
    "",
    `export const migrations: DrizzleMigration[] = ${JSON.stringify(migrations, null, 2)};`,
    "",
  ].join("\n");
}

export function bundle_migrations(folder: string): string {
  const target = join(folder, "index.ts");
  writeFileSync(target, migrations_module(read_migrations(folder)));
  return target;
}

// ── Command ──────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const [folder] = process.argv.slice(2);
  if (!folder) {
    console.error("Usage: x-libs-bundle-migrations <folder drizzle-kit wrote the migrations to>");
    process.exit(2);
  }
  console.info(`Wrote ${bundle_migrations(resolve(folder))}`);
}
