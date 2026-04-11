import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/pi-stack/test/smoke/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
