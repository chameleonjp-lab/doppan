import { describe, expect, it } from "vitest";
import { getBuildInfo } from "../../src/build-info";
import { defaultBuildTarget } from "../../vite.config";

describe("build info", () => {
  it("normalizes the public development preview metadata", () => {
    expect(
      getBuildInfo({
        VITE_BUILD_ENV: "development-preview",
        VITE_BUILD_TARGET: "GitHub Pages / development-preview",
        VITE_COMMIT_SHA: "abc123",
        VITE_BUILD_AT: "2026-08-09T00:00:00.000Z",
      }),
    ).toEqual({
      environment: "development-preview",
      target: "GitHub Pages / development-preview",
      sha: "abc123",
      builtAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("falls back to a safe environment and visible placeholders", () => {
    expect(getBuildInfo({ MODE: "staging", VITE_COMMIT_SHA: "  " })).toEqual({
      environment: "development-preview",
      target: "GitHub Pages / development-preview",
      sha: "unknown",
      builtAt: "not available",
    });
  });

  it("derives non-preview build targets from the selected environment", () => {
    expect(defaultBuildTarget("production")).toBe("GitHub Pages / production");
    expect(defaultBuildTarget("test")).toBe("CI / test");
    expect(getBuildInfo({ VITE_BUILD_ENV: "production" }).target).toBe("GitHub Pages / production");
  });
});
