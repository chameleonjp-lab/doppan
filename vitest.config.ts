import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/physics/**/*.test.ts"],
    coverage: {
      enabled: false,
    },
  },
});
