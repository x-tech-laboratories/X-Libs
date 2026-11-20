import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        autoUpdate: (new_threshold) => Math.floor(new_threshold),
        lines: 89,
        statements: 86,
        functions: 84,
        branches: 81,
      },
    },
  },
});
