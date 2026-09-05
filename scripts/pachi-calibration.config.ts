import { defineConfig } from "vitest/config";

// A manual distribution check. Keep hundreds of simulated games outside the
// quick regression suite used by every pull request.
export default defineConfig({
  root: ".",
  test: {
    environment: "node",
    include: ["scripts/run-calibration.test.ts"],
    testTimeout: 600_000,
  },
});
