import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // Each file boots its own in-process Postgres; give the first migration time.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
