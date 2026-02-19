import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/index.ts"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      provider: "v8",
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
