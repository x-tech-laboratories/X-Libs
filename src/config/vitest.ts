// The base app's Vitest config: tests in tests/, coverage of src/ reported to the terminal, and one time zone for all
// runs. An app merges its own coverage floor into it, kept in its vitest.config.ts so autoUpdate can raise it there.

// ── Imports ──────────────────────────────────────────────────────────────────

import react from "@vitejs/plugin-react";
import type { ViteUserConfig } from "vitest/config";

// ── Tests ────────────────────────────────────────────────────────────────────

export function vitest_config(): ViteUserConfig {
  // Tests read local dates, so every run uses the same time zone.
  process.env.TZ = "UTC";
  return {
    plugins: [react()],
    test: {
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      coverage: { provider: "v8", include: ["src/**/*.{ts,tsx}"], reporter: ["text"] },
    },
  };
}
