import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@frenchfry/core": resolve(currentDirectory, "../core/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
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
