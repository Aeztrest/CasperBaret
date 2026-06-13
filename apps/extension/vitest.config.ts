import { defineConfig } from "vitest/config";

/**
 * Dedicated vitest config (separate from vite.config.ts, which loads the crxjs
 * plugin for building the extension). Runs unit tests in a node environment.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
