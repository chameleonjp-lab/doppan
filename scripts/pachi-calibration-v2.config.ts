import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  test: {
    environment: "node",
    include: ["scripts/run-calibration-v2.test.ts"],
    testTimeout: 3_600_000,
  },
});
